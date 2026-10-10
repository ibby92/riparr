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
};

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
  return null;
}

/** Normalizes a root folder path: absolute, no trailing slash. */
export function normalizeRootPath(p: string): string {
  const resolved = path.resolve(p.trim());
  return resolved.length > 1 ? resolved.replace(/\/+$/, "") : resolved;
}

export function listRootFolders(): RootFolderWithSpace[] {
  const rows = all<RootFolder & { title_count: number }>(
    `SELECT r.*, (SELECT COUNT(*) FROM titles t WHERE t.root_folder_id = r.id) AS title_count
       FROM root_folders r ORDER BY r.path`,
  );
  return rows.map((r) => {
    try {
      const s = fs.statfsSync(r.path);
      fs.accessSync(r.path, fs.constants.W_OK);
      return { ...r, free_bytes: s.bavail * s.bsize, total_bytes: s.blocks * s.bsize, accessible: true };
    } catch {
      return { ...r, free_bytes: null, total_bytes: null, accessible: false };
    }
  });
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
