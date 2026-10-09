import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { sanitizeSegment } from "@/lib/paths";

/** One archive: `entry` is the volume 7-Zip is pointed at; `volumes` includes it, entry first. */
export type ArchiveSet = { entry: string; volumes: string[]; name: string };

export type ExtractResult =
  | { status: "extracted"; files: string[] }
  | { status: "incomplete" }
  | { status: "wrong_password" }
  | { status: "failed"; error: string };

export type ExtractOptions = {
  sevenZip: string;
  destDir: string;
  /** Tried in order, after an empty password. */
  passwords: string[];
  signal: AbortSignal;
};

const TEMP_PREFIX = ".riparr-extract-";
const OUTPUT_CAP = 64 * 1024;

// ---------------------------------------------------------------------------
// Binary discovery

/** Runs a command, collecting stdout+stderr (capped). Never prompts: stdin is closed. */
function run(
  bin: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ code: number | null; output: string; spawnError?: Error }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], signal, killSignal: "SIGKILL" });
    let output = "";
    const collect = (chunk: Buffer) => {
      if (output.length < OUTPUT_CAP) output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let spawnError: Error | undefined;
    child.on("error", (err) => {
      // Spawn failures never emit "close"; aborts do, once the child is dead.
      if (child.pid === undefined) resolve({ code: null, output, spawnError: err });
      else spawnError = err;
    });
    child.on("close", (code) => resolve({ code, output, spawnError }));
  });
}

let found: Promise<string | null> | undefined;

/**
 * Finds a 7-Zip CLI: `RIPARR_7Z` if set, else the first of 7z/7zz/7za on PATH
 * that lists the Rar5 codec, else the first that runs at all. Cached.
 */
export function findSevenZip(): Promise<string | null> {
  found ??= (async () => {
    const env = process.env.RIPARR_7Z?.trim();
    const candidates = env ? [env] : ["7z", "7zz", "7za"];
    let fallback: string | null = null;
    for (const bin of candidates) {
      const { output, spawnError } = await run(bin, ["i"]);
      if (spawnError || !/7-Zip/.test(output)) continue;
      if (/\bRar5\b/.test(output)) return bin;
      fallback ??= bin;
    }
    return fallback;
  })();
  return found;
}

// ---------------------------------------------------------------------------
// Volume grouping

type Kind = "rar-part" | "rar" | "split" | "zip" | "7z";
type Vol = { file: string; kind: Kind; stem: string; num: number; first: boolean };

/** Classifies a basename as an archive volume, or null. `num` orders volumes within a set. */
function parseVolume(file: string): Vol | null {
  const base = path.basename(file);
  let m: RegExpMatchArray | null;
  if ((m = base.match(/^(.+)\.part(\d+)\.rar$/i))) {
    const n = Number(m[2]);
    return { file, kind: "rar-part", stem: m[1], num: n, first: n === 1 };
  }
  if ((m = base.match(/^(.+)\.rar$/i))) return { file, kind: "rar", stem: m[1], num: -1, first: true };
  if ((m = base.match(/^(.+)\.r(\d{2,3})$/i))) return { file, kind: "rar", stem: m[1], num: Number(m[2]), first: false };
  if ((m = base.match(/^(.+)\.(\d{3})$/))) {
    const n = Number(m[2]);
    return { file, kind: "split", stem: m[1], num: n, first: n === 1 };
  }
  if ((m = base.match(/^(.+)\.zip$/i))) return { file, kind: "zip", stem: m[1], num: 0, first: true };
  if ((m = base.match(/^(.+)\.z(\d{2,3})$/i))) return { file, kind: "zip", stem: m[1], num: Number(m[2]), first: false };
  if ((m = base.match(/^(.+)\.7z$/i))) return { file, kind: "7z", stem: m[1], num: 0, first: true };
  return null;
}

const displayName = (v: Vol) => (v.kind === "split" ? v.stem.replace(/\.(7z|zip|rar)$/i, "") : v.stem);

/**
 * Groups a directory listing into archive sets. Recognises x.rar (+ x.r00…),
 * x.partN.rar, x.7z, x.zip (+ x.z01…), x.7z.001 / x.zip.001 / x.001. A set is
 * only returned once its first volume (part1, .rar, .zip, .001) is present.
 * Non-archives, `.part` partials and anything under a `.riparr-*` dir are ignored.
 */
export function findArchiveSets(files: string[]): ArchiveSet[] {
  const groups = new Map<string, Vol[]>();
  for (const file of files) {
    if (/\.part$/i.test(file)) continue;
    if (file.split(/[/\\]/).some((seg) => seg.startsWith(".riparr-"))) continue;
    const vol = parseVolume(file);
    if (!vol) continue;
    const key = `${vol.kind}\0${path.dirname(file)}\0${vol.stem.toLowerCase()}`;
    const list = groups.get(key);
    if (list) list.push(vol);
    else groups.set(key, [vol]);
  }

  const sets: ArchiveSet[] = [];
  for (const vols of groups.values()) {
    const entry = vols.find((v) => v.first);
    if (!entry) continue;
    vols.sort((a, b) => (a === entry ? -1 : b === entry ? 1 : a.num - b.num || a.file.localeCompare(b.file)));
    sets.push({ entry: entry.file, volumes: vols.map((v) => v.file), name: displayName(entry) });
  }
  return sets.sort((a, b) => a.entry.localeCompare(b.entry));
}

// ---------------------------------------------------------------------------
// Extraction

type Outcome = "ok" | "incomplete" | "wrong_password" | "failed";

const INCOMPLETE = /Missing volume|Unexpected end of (archive|data)/i;
const WRONG_PASSWORD = /Wrong password|Cannot open encrypted archive|(CRC Failed|Data Error) in encrypted file/i;

/**
 * Maps a 7-Zip run to an outcome. Missing/truncated volumes win over password
 * errors: with a volume missing, encrypted data also fails its checks.
 */
export function classify(code: number | null, output: string): Outcome {
  if (INCOMPLETE.test(output)) return "incomplete";
  if (WRONG_PASSWORD.test(output)) return "wrong_password";
  return code === 0 || code === 1 ? "ok" : "failed";
}

/** Last meaningful error lines of 7-Zip output, for the UI. */
function errorSummary(code: number | null, output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /error|cannot|can't|unsupported|not enough|no space/i.test(l) && !/^(Archives|Sub items|Open) Errors?:/i.test(l));
  return (lines.slice(-3).join("; ") || `7-Zip exited with code ${code}`).slice(0, 500);
}

const isInside = (root: string, p: string) => p === root || p.startsWith(root + path.sep);

/**
 * Removes anything in `root` that isn't a regular file or directory (symlinks
 * included, wherever they point) or that resolves outside `root`.
 */
async function scrub(root: string, dir = root): Promise<void> {
  for (const name of await readdir(dir)) {
    const p = path.join(dir, name);
    const st = await lstat(p);
    if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory()) || !isInside(root, await realpath(p))) {
      await rm(p, { recursive: true, force: true });
    } else if (st.isDirectory()) {
      await scrub(root, p);
    }
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/** First of "x.mkv", "x (1).mkv", … in `dir` that is free (or is a dir, if `mergeDir`). */
async function freeName(dir: string, name: string, mergeDir: boolean): Promise<string> {
  const ext = mergeDir ? "" : path.extname(name);
  const stem = ext && ext !== name ? name.slice(0, -ext.length) : name;
  for (let i = 0; ; i++) {
    const candidate = path.join(dir, i === 0 ? name : `${stem} (${i})${ext}`);
    try {
      const st = await lstat(candidate);
      if (mergeDir && st.isDirectory()) return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return candidate;
      throw err;
    }
  }
}

/** Moves the contents of `from` into `to`, merging directories and suffixing clashing files. */
async function moveInto(from: string, to: string, moved: string[]): Promise<void> {
  for (const name of (await readdir(from)).sort()) {
    const src = path.join(from, name);
    const safe = sanitizeSegment(name);
    if ((await lstat(src)).isDirectory()) {
      const target = await freeName(to, safe, true);
      if (!(await exists(target))) await mkdir(target);
      await moveInto(src, target, moved);
    } else {
      const target = await freeName(to, safe, false);
      await rename(src, target);
      moved.push(target);
    }
  }
}

/** One 7-Zip attempt into a fresh temp dir under `destDir`; the caller removes it. */
async function attempt(set: ArchiveSet, password: string, tmp: string, opts: ExtractOptions) {
  const args = ["x", "-y", "-bso0", "-bsp0", "-sccUTF-8", `-p${password}`, `-o${tmp}`, "--", set.entry];
  const { code, output, spawnError } = await run(opts.sevenZip, args, opts.signal);
  opts.signal.throwIfAborted();
  if (spawnError) return { outcome: "failed" as const, error: `Cannot run ${opts.sevenZip}: ${spawnError.message}` };
  const outcome = classify(code, output);
  return { outcome, error: outcome === "failed" ? errorSummary(code, output) : "" };
}

/**
 * Extracts `set` into `destDir`, trying an empty password and then each of
 * `passwords`. Files land via a temp dir; existing files are never overwritten
 * ("x (1).mkv"), names are sanitized, and symlinks/special files are dropped.
 * Throws the abort reason if `signal` fires (the child is killed).
 */
export async function extractSet(set: ArchiveSet, opts: ExtractOptions): Promise<ExtractResult> {
  opts.signal.throwIfAborted();
  const destDir = path.resolve(opts.destDir);
  await mkdir(destDir, { recursive: true });
  const passwords = [...new Set(["", ...opts.passwords])];

  let sawWrongPassword = false;
  for (const password of passwords) {
    const tmp = await realpath(await mkdtemp(path.join(destDir, TEMP_PREFIX)));
    try {
      const { outcome, error } = await attempt(set, password, tmp, opts);
      if (outcome === "incomplete") return { status: "incomplete" };
      if (outcome === "failed") return { status: "failed", error };
      if (outcome === "wrong_password") {
        sawWrongPassword = true;
        continue;
      }
      await scrub(tmp);
      const files: string[] = [];
      await moveInto(tmp, destDir, files);
      return { status: "extracted", files };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  return sawWrongPassword ? { status: "wrong_password" } : { status: "failed", error: "No password to try" };
}

/** Deletes every volume of `set` (missing files are fine). */
export async function deleteVolumes(set: ArchiveSet): Promise<void> {
  for (const file of set.volumes) {
    try {
      await unlink(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
