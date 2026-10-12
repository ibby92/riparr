// Finds video files already in a title's folder: episodes the user had before
// adding the title, or put there by hand. Riparr counts them as on disk and
// doesn't download those episodes again.
import fs from "node:fs";
import path from "node:path";
import { all, getDb, one, run } from "./db";
import { logDebug } from "./events";
import { parseEpisode } from "./episodes";
import { getTitle, type TitleType } from "./titles";

export const VIDEO_EXTENSIONS = /\.(mkv|mp4|m4v|avi|mov|wmv|ts|m2ts|webm|flv|mpg|mpeg)$/i;
/** Seasons, extras and similar sub-folders are scanned; deeper trees are not. */
const MAX_DEPTH = 3;

export type DiskFile = {
  title_id: number;
  path: string;
  size: number;
  season: number | null;
  episode: number | null;
  mtime: number;
};

/** Video files under `dir` (hidden files and folders, e.g. .riparr-partial, are skipped). */
export function findVideos(dir: string, depth = 0): { path: string; size: number; mtime: number }[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { path: string; size: number; mtime: number }[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < MAX_DEPTH) out.push(...findVideos(full, depth + 1));
    } else if (e.isFile() && VIDEO_EXTENSIONS.test(e.name)) {
      try {
        const st = fs.statSync(full);
        out.push({ path: full, size: st.size, mtime: Math.round(st.mtimeMs) });
      } catch {
        // Vanished while scanning.
      }
    }
  }
  return out;
}

/** Season/episode of a file on disk: from its name, else from a "Season NN" folder it sits in. */
export function diskEpisode(filePath: string, type: TitleType): { season: number | null; episode: number | null } {
  if (type === "movie") return { season: null, episode: null };
  const ref = parseEpisode(path.basename(filePath));
  if (!ref) return { season: null, episode: null };
  const folderSeason = /^Season[ ._-]?(\d{1,3})$/i.exec(path.basename(path.dirname(filePath)));
  // "Show EP05.mkv" in "Season 02" is S02E05, not the season-1 default.
  const bare = !/S\d{1,3}[ ._-]?E\d|\d{1,2}x\d{2,3}|Season/i.test(path.basename(filePath));
  return { season: bare && folderSeason ? Number(folderSeason[1]) : ref.season, episode: ref.episode };
}

/**
 * Rescans one title's folder and replaces its disk_files rows. Leaves the rows
 * alone when the root folder itself is unreachable (an unmounted share
 * shouldn't make every episode look missing). Returns the files found, or
 * null when the scan was skipped.
 */
export function scanTitle(titleId: number, now = Date.now()): DiskFile[] | null {
  const title = getTitle(titleId);
  if (!title) return null;
  if (!fs.existsSync(title.root_path)) {
    logDebug("scan", `Not scanning: root folder ${title.root_path} isn't reachable; keeping the last scan`, titleId);
    return null;
  }
  const folder = path.join(title.root_path, title.folder);
  const files: DiskFile[] = findVideos(folder).map((f) => ({ title_id: titleId, ...f, ...diskEpisode(f.path, title.type) }));

  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    run("DELETE FROM disk_files WHERE title_id = ?", titleId);
    const insert = db.prepare("INSERT INTO disk_files (title_id, path, size, season, episode, mtime) VALUES (?, ?, ?, ?, ?, ?)");
    for (const f of files) insert.run(f.title_id, f.path, f.size, f.season, f.episode, f.mtime);
    run("UPDATE titles SET disk_scanned_at = ? WHERE id = ?", now, titleId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  logDebug("scan", () => {
    const eps = files.filter((f) => f.episode != null).length;
    return `Scanned ${folder}: ${files.length} video file(s), ${eps} with an episode number`;
  }, titleId);
  return files;
}

/**
 * Files in the title's folder that Riparr didn't download itself: no file row
 * of the title points at them. These are what makes an episode count as
 * already on disk (Riparr's own downloads are tracked by their file rows).
 */
export function externalDiskFiles(titleId?: number): DiskFile[] {
  const where = titleId === undefined ? "" : "AND d.title_id = ?";
  return all<DiskFile>(
    `SELECT d.* FROM disk_files d
      WHERE NOT EXISTS (SELECT 1 FROM files f JOIN links l ON l.id = f.link_id
                         WHERE l.title_id = d.title_id AND f.local_path = d.path AND f.status = 'done')
        ${where}
      ORDER BY d.title_id, d.season, d.episode, d.path`,
    ...(titleId === undefined ? [] : [titleId]),
  );
}

/** Titles whose folder hasn't been scanned for `maxAgeMs`, oldest first. */
export function staleScans(maxAgeMs: number, limit: number, now = Date.now()): number[] {
  return all<{ id: number }>(
    `SELECT id FROM titles WHERE archived_at IS NULL AND (disk_scanned_at IS NULL OR disk_scanned_at < ?)
      ORDER BY COALESCE(disk_scanned_at, 0), id LIMIT ?`,
    now - maxAgeMs,
    limit,
  ).map((r) => r.id);
}

export function lastScan(titleId: number): number | null {
  return one<{ disk_scanned_at: number | null }>("SELECT disk_scanned_at FROM titles WHERE id = ?", titleId)?.disk_scanned_at ?? null;
}
