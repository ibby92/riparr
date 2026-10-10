import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, stat, truncate, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { StallError } from "./errors";
import type { FileHash, RemoteFile } from "./hosts/types";

export type DownloadResult = { status: "skipped"; path: string } | { status: "done"; path: string; bytes: number };

export type DownloadOptions = {
  finalPath: string;
  /** Where bytes land while downloading; kept on abort/error so the next call resumes. */
  partialPath: string;
  signal: AbortSignal;
  /** Called at most ~4 times a second, plus once at the end. `bytesDone` includes resumed bytes. */
  onProgress?: (bytesDone: number, total: number | null) => void;
  /** Bandwidth cap; null/undefined = unlimited. */
  bytesPerSecond?: number | null;
  /** Called once the host answers, with the byte offset the transfer starts at (bytes before it are already on disk). */
  onStart?: (offset: number) => void;
  /** Abort with StallError when no bytes arrive for this long (headers included); null/0 = never. */
  stallMs?: number | null;
};

const PROGRESS_INTERVAL_MS = 250;

async function sizeOf(p: string): Promise<number | null> {
  try {
    return (await stat(p)).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** True if a file already on disk looks like a finished copy of `file`. */
const isComplete = (size: number, file: RemoteFile) => (file.size !== null ? size === file.size : size > 0);

/**
 * Picks where to place the file: the first of "x.mkv", "x (1).mkv", ... that is
 * free, or `skip` if one of them already holds a complete copy.
 */
async function placement(finalPath: string, file: RemoteFile): Promise<{ skip: boolean; path: string }> {
  const { dir, name, ext } = path.parse(finalPath);
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? finalPath : path.join(dir, `${name} (${i})${ext}`);
    const size = await sizeOf(candidate);
    if (size === null) return { skip: false, path: candidate };
    if (isComplete(size, file)) return { skip: true, path: candidate };
  }
}

/** Token bucket limiter (1/4 s burst) that also reports progress. */
function meter(
  start: number,
  total: number | null,
  signal: AbortSignal,
  onProgress: DownloadOptions["onProgress"],
  rate: number | null,
  onData?: () => void,
): Transform {
  let done = start;
  let lastReport = 0;
  const capacity = rate ? Math.max(rate / 4, 1) : 0;
  let tokens = capacity;
  let refilledAt = Date.now();
  return new Transform({
    async transform(chunk: Buffer, _enc, cb) {
      try {
        onData?.();
        if (rate) {
          const now = Date.now();
          tokens = Math.min(capacity, tokens + ((now - refilledAt) / 1000) * rate);
          refilledAt = now;
          tokens -= chunk.length;
          if (tokens < 0) {
            await sleep((-tokens / rate) * 1000, undefined, { signal });
            tokens = 0;
            refilledAt = Date.now();
            // Throttling isn't stalling.
            onData?.();
          }
        }
        done += chunk.length;
        const now = Date.now();
        if (onProgress && now - lastReport >= PROGRESS_INTERVAL_MS) {
          lastReport = now;
          onProgress(done, total);
        }
        cb(null, chunk);
      } catch (err) {
        cb(err as Error);
      }
    },
  });
}

async function hashFile(p: string, algo: FileHash["algo"], signal: AbortSignal): Promise<Buffer> {
  const hash = createHash(algo);
  await pipeline(createReadStream(p), hash, { signal });
  return hash.digest();
}

/** Fires `abort` when `touch` hasn't been called for `ms`. Real time, so a test clock can't trip it. */
function watchdog(ms: number) {
  const controller = new AbortController();
  let last = Date.now();
  const timer = setInterval(
    () => {
      if (Date.now() - last < ms) return;
      clearInterval(timer);
      controller.abort(new StallError(`No data for ${Math.round(ms / 1000)}s`));
    },
    Math.max(10, Math.min(ms / 4, 5_000)),
  );
  timer.unref?.();
  return {
    signal: controller.signal,
    touch: () => void (last = Date.now()),
    stop: () => clearInterval(timer),
  };
}

/** Moves `from` to `to`, copying when they are on different filesystems. */
async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    const tmp = `${to}.riparr-tmp`;
    await copyFile(from, tmp);
    await rename(tmp, to);
    await unlink(from);
  }
}

/**
 * Downloads `file` to `finalPath` via `partialPath`, resuming a previous partial
 * when the host honours Range. Verifies size and hash, then renames into place.
 * Skips if a complete copy already exists; picks "name (n).ext" if a different
 * file is in the way. On abort or error the partial is left for the next call.
 */
export async function downloadFile(file: RemoteFile, opts: DownloadOptions): Promise<DownloadResult> {
  const { partialPath, signal } = opts;
  signal.throwIfAborted();
  await mkdir(path.dirname(opts.finalPath), { recursive: true });
  await mkdir(path.dirname(partialPath), { recursive: true });

  const target = await placement(opts.finalPath, file);
  if (target.skip) return { status: "skipped", path: target.path };

  let existing = (await sizeOf(partialPath)) ?? 0;
  if (file.size !== null && existing > file.size) {
    await truncate(partialPath, 0);
    existing = 0;
  }

  if (file.size === null || existing < file.size) {
    // Only the transfer is watched; hashing a big file afterwards can legitimately take minutes.
    const stall = opts.stallMs ? watchdog(opts.stallMs) : null;
    const transfer = stall ? AbortSignal.any([signal, stall.signal]) : signal;
    try {
      const { body, offset } = await file.open(existing, transfer);
      if (offset > existing) {
        await body.cancel().catch(() => {});
        throw new Error(`Host resumed at byte ${offset}, but only ${existing} bytes are on disk`);
      }
      if (existing > 0 && offset < existing) await truncate(partialPath, offset);
      stall?.touch();
      opts.onStart?.(offset);
      await pipeline(
        Readable.fromWeb(body as WebReadableStream<Uint8Array>),
        meter(offset, file.size, transfer, opts.onProgress, opts.bytesPerSecond ?? null, stall?.touch),
        createWriteStream(partialPath, { flags: "a" }),
        { signal: transfer },
      );
    } catch (err) {
      // The partial stays either way; a stall is reported as such so the caller retries soon.
      if (stall?.signal.aborted && !signal.aborted) throw stall.signal.reason as StallError;
      throw err;
    } finally {
      stall?.stop();
    }
  }

  const bytes = (await sizeOf(partialPath)) ?? 0;
  opts.onProgress?.(bytes, file.size);
  if (file.size !== null && bytes !== file.size) {
    // Too long means garbage; too short may still resume next time.
    if (bytes > file.size) await unlink(partialPath);
    throw new Error(`Size mismatch: expected ${file.size} bytes, got ${bytes}`);
  }

  if (file.hash) {
    const digest = await hashFile(partialPath, file.hash.algo, signal);
    const want = file.hash.value.trim();
    if (want.toLowerCase() !== digest.toString("hex") && want !== digest.toString("base64")) {
      await unlink(partialPath);
      throw new Error(`${file.hash.algo} checksum mismatch: expected ${want}, got ${digest.toString("hex")}`);
    }
  }

  await move(partialPath, target.path);
  return { status: "done", path: target.path, bytes };
}
