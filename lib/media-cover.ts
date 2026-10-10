/**
 * Poster cache, like the *arr apps' MediaCover folder:
 *   <configDir>/MediaCover/<type>-<tmdbId>/poster-<size>.jpg
 * Each poster is downloaded once from TMDB's image CDN and served locally afterwards.
 * Server-only (node:fs).
 */
import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { POSTER_SIZES, posterUrl, type MediaType, type PosterSize } from "./tmdb";

export const MEDIA_COVER_DIR = "MediaCover";
export const POSTER_MAX_BYTES = 5 * 1024 * 1024;
export const POSTER_TIMEOUT_MS = 30_000;

export type PosterRef = { tmdbId: number; type: MediaType; posterPath: string | null | undefined };
export type CacheOptions = {
  configDir: string;
  fetch?: typeof fetch;
  size?: PosterSize;
  /** Re-download even if the file exists (e.g. TMDB changed the poster). */
  force?: boolean;
  signal?: AbortSignal;
};
export type CacheResult = { path: string; downloaded: boolean } | null;
export type ImageType = "image/jpeg" | "image/png" | "image/webp";

function assertRef(tmdbId: number, type: MediaType) {
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) throw new Error(`Invalid TMDB id: ${tmdbId}`);
  if (type !== "show" && type !== "movie") throw new Error(`Invalid media type: ${String(type)}`);
}

function assertSize(size: string): asserts size is PosterSize {
  if (!(POSTER_SIZES as readonly string[]).includes(size)) throw new Error(`Invalid poster size: ${size}`);
}

/** `<configDir>/MediaCover/<type>-<tmdbId>`; ids are validated so the path can't escape. */
export function coverDir(tmdbId: number, type: MediaType, configDir: string): string {
  assertRef(tmdbId, type);
  return path.join(configDir, MEDIA_COVER_DIR, `${type}-${tmdbId}`);
}

export function posterPathFor(tmdbId: number, type: MediaType, configDir: string, size: PosterSize = "w342") {
  assertSize(size);
  return path.join(coverDir(tmdbId, type, configDir), `poster-${size}.jpg`);
}

/** Identifies JPEG/PNG/WebP by magic bytes; null for anything else. */
export function sniffImageType(buf: Uint8Array): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => buf[i] === b)
  )
    return "image/png";
  if (
    buf.length >= 12 &&
    String.fromCharCode(...buf.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...buf.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

/** TMDB image paths look like "/AbC123_x-y.jpg"; anything else (slashes, "..") is rejected. */
const SAFE_POSTER_PATH = /^\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i;

async function exists(p: string) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`Poster too large (${declared} bytes)`);
  }
  if (!res.body) throw new Error("Empty poster response");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      throw new Error(`Poster too large (over ${cap} bytes)`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/**
 * Downloads a title's poster into the cache unless it's already there.
 * Returns null when the title has no poster; throws on network/validation errors.
 */
export async function cachePoster(ref: PosterRef, opts: CacheOptions): Promise<CacheResult> {
  const size = opts.size ?? "w342";
  const dest = posterPathFor(ref.tmdbId, ref.type, opts.configDir, size);
  if (!ref.posterPath) return null;
  if (!SAFE_POSTER_PATH.test(ref.posterPath)) throw new Error(`Unexpected TMDB poster path: ${ref.posterPath}`);
  if (!opts.force && (await exists(dest))) return { path: dest, downloaded: false };

  const url = posterUrl(ref.posterPath, size)!;
  const timeout = AbortSignal.timeout(POSTER_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(url, { signal, redirect: "follow" });
  } catch (err) {
    if (opts.signal?.aborted) throw opts.signal.reason ?? err;
    if (timeout.aborted) throw new Error("Poster download timed out");
    throw new Error(`Could not download poster (${err instanceof Error ? err.message : String(err)})`, { cause: err });
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`Poster download failed: HTTP ${res.status}`);
  }
  const ctype = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ctype.startsWith("image/")) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`Poster is not an image (${ctype || "no content-type"})`);
  }
  const bytes = await readCapped(res, POSTER_MAX_BYTES);
  if (!sniffImageType(bytes)) throw new Error("Poster is not a JPEG, PNG or WebP image");

  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, dest);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  return { path: dest, downloaded: true };
}

/** The cached poster's path, or null if it hasn't been downloaded. */
export async function posterFile(
  tmdbId: number,
  type: MediaType,
  configDir: string,
  size: PosterSize = "w342",
): Promise<string | null> {
  const p = posterPathFor(tmdbId, type, configDir, size);
  return (await exists(p)) ? p : null;
}

/** Deletes every cached image for a title (e.g. when the title is removed or re-matched). */
export async function removePosters(tmdbId: number, type: MediaType, configDir: string): Promise<void> {
  await rm(coverDir(tmdbId, type, configDir), { recursive: true, force: true });
}
