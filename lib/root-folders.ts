import fs from "node:fs";
import path from "node:path";
import { all, one, run } from "./db";

/** A library root, like Sonarr/Radarr's: an absolute path inside the container (e.g. /media/Kdrama). */
export type RootFolder = { id: number; path: string; created_at: number };

export type RootFolderWithSpace = RootFolder & {
  free_bytes: number | null;
  total_bytes: number | null;
  /** False when the path is missing or not writable right now. */
  accessible: boolean;
  title_count: number;
  /** Filesystem device id: roots on the same disk share free space (null if unreachable). */
  device: number | null;
  /** Another root folder this one is inside of, or contains (overlapping roots confuse folder scans and defaults). */
  overlaps: string | null;
};

/** True when `child` is strictly inside `parent` (both normalized absolute paths). */
function isInside(child: string, parent: string) {
  return child !== parent && child.startsWith(parent === "/" ? "/" : `${parent}/`);
}

/** The root folder among `others` that `p` is inside of or contains, if any. */
function overlapping(p: string, others: string[]): string | null {
  return others.find((o) => isInside(p, o) || isInside(o, p)) ?? null;
}

/** Why `p` can't be a root folder, or null if it can. */
export function rootFolderError(p: string): string | null {
  if (!path.isAbsolute(p)) return "Use an absolute path, e.g. /media/TV";
  try {
    if (!fs.statSync(p).isDirectory()) return "That path is a file, not a folder";
    fs.accessSync(p, fs.constants.W_OK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "Folder doesn't exist (check your Docker volume mapping)";
    if (code === "EACCES" || code === "EPERM") return "Riparr can't write to this folder (check PUID/PGID and permissions)";
    return `Can't use this folder (${code ?? "unknown error"})`;
  }
  const existing = all<{ path: string }>("SELECT path FROM root_folders WHERE path != ?", p).map((r) => r.path);
  const other = overlapping(p, existing);
  if (other) {
    return isInside(p, other)
      ? `This folder is inside the root folder ${other}. Use that root and give the title a sub-folder, or remove ${other} first.`
      : `This folder contains the root folder ${other}. Root folders can't be nested; add the folders beside ${other} instead.`;
  }
  return null;
}

/** Normalizes a root folder path: no trailing slash, "." and ".." resolved. Relative paths stay relative (and are refused). */
export function normalizeRootPath(p: string): string {
  const trimmed = p.trim();
  if (!path.isAbsolute(trimmed)) return trimmed;
  const resolved = path.posix.normalize(trimmed);
  return resolved.length > 1 ? resolved.replace(/\/+$/, "") : resolved;
}

export function listRootFolders(): RootFolderWithSpace[] {
  const rows = all<RootFolder & { title_count: number }>(
    `SELECT r.*, (SELECT COUNT(*) FROM titles t WHERE t.root_folder_id = r.id) AS title_count
       FROM root_folders r ORDER BY r.path`,
  );
  const paths = rows.map((r) => r.path);
  return rows.map((r) => {
    const overlaps = overlapping(r.path, paths);
    try {
      const s = fs.statfsSync(r.path);
      fs.accessSync(r.path, fs.constants.W_OK);
      const device = fs.statSync(r.path).dev;
      return { ...r, free_bytes: s.bavail * s.bsize, total_bytes: s.blocks * s.bsize, accessible: true, device, overlaps };
    } catch {
      return { ...r, free_bytes: null, total_bytes: null, accessible: false, device: null, overlaps };
    }
  });
}

/**
 * Free and total space across root folders, counting each disk once (several
 * roots on one disk share its free space). Null when no root is reachable.
 */
export function diskTotals(roots: RootFolderWithSpace[]): { free: number; total: number; disks: number } | null {
  const seen = new Map<number, { free: number; total: number }>();
  for (const r of roots) {
    if (r.device === null || r.free_bytes === null || r.total_bytes === null) continue;
    if (!seen.has(r.device)) seen.set(r.device, { free: r.free_bytes, total: r.total_bytes });
  }
  if (seen.size === 0) return null;
  let free = 0;
  let total = 0;
  for (const d of seen.values()) {
    free += d.free;
    total += d.total;
  }
  return { free, total, disks: seen.size };
}

export function getRootFolder(id: number): RootFolder | undefined {
  return one<RootFolder>("SELECT * FROM root_folders WHERE id = ?", id);
}

/** Adds a root folder; returns its id (the existing id if the path is already a root folder). */
export function addRootFolder(p: string): number {
  const normalized = normalizeRootPath(p);
  const existing = one<{ id: number }>("SELECT id FROM root_folders WHERE path = ?", normalized);
  if (existing) return existing.id;
  return Number(run("INSERT INTO root_folders (path, created_at) VALUES (?, ?)", normalized, Date.now()).lastInsertRowid);
}

/** Removes a root folder unless titles still use it. Returns false if it's in use. */
export function removeRootFolder(id: number): boolean {
  const used = one<{ n: number }>("SELECT COUNT(*) AS n FROM titles WHERE root_folder_id = ?", id)?.n ?? 0;
  if (used > 0) return false;
  run("DELETE FROM root_folders WHERE id = ?", id);
  return true;
}

export type DirEntry = { name: string; path: string };

/**
 * Sub-folders of `dir` for the folder picker (hidden folders and Riparr's own
 * work folders are skipped). Throws a readable error if the folder can't be read.
 */
export function listDirectories(dir: string): { path: string; parent: string | null; dirs: DirEntry[] } {
  const target = normalizeRootPath(dir || "/");
  if (!path.isAbsolute(target)) throw new Error("Use an absolute path, e.g. /media");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new Error(code === "ENOENT" ? `${target} doesn't exist` : `Can't open ${target} (${code})`);
  }
  const dirs = entries
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith("."))
    .filter((e) => {
      if (!e.isSymbolicLink()) return true;
      try {
        return fs.statSync(path.join(target, e.name)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  return { path: target, parent: target === "/" ? null : path.dirname(target), dirs };
}
