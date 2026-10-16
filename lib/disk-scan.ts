// The folder is the source of truth for what's on disk. A scan records every video file in a
// title's folder (disk_files): Riparr's downloads, episodes the user had before adding the
// title, or put there by hand. Every view counts an episode as on disk only through these rows,
// and syncFolder() brings the rest of the database in line with them.
import fs from "node:fs";
import path from "node:path";
import { all, getDb, one, run } from "./db";
import { logDebug, logEvent } from "./events";
import { parseEpisode } from "./episodes";
import { getTitle, type TitleType } from "./titles";
import { isVideo, VIDEO_EXTENSIONS } from "./video";

export { isVideo, isVideoSql, VIDEO_EXTENSIONS } from "./video";

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

/** A file named in an activity entry (History). */
export type MissingFile = { name: string; season: number | null; episode: number | null; size: number | null };

const nameKey = (name: string) => name.normalize("NFC").trim().toLowerCase();

/** The last path segment of a link, decoded: a file name for direct links. */
function urlName(url: string): string | null {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

/**
 * Dead links (failed or offline) holding the episodes of these files are resolved again: a host
 * that failed the first time (say gofile with a stale token) may work now, and host priority
 * should decide again. Mirror selection waits while they resolve; one that fails again just
 * leaves the other copies to it. A link matches by episode or by file name, taken from its files,
 * or from the source's details and its URL when it never got as far as listing them. For movies,
 * every dead link counts.
 * Returns how many links were revived.
 */
export function reviveDeadLinks(fileIds: number[], now = Date.now()): number {
  if (fileIds.length === 0) return 0;
  const wanted = all<{ title_id: number; type: TitleType; name: string; season: number | null; episode: number | null }>(
    `SELECT DISTINCT l.title_id, t.type, f.remote_name AS name, f.season, f.episode FROM files f JOIN links l ON l.id = f.link_id JOIN titles t ON t.id = l.title_id
      WHERE f.id IN (${fileIds.map(() => "?").join(",")})`,
    ...fileIds,
  );
  const key = (season: number | null, episode: number | null) => `${season ?? 1}x${episode}`;
  const revive: number[] = [];
  for (const titleId of new Set(wanted.map((w) => w.title_id))) {
    const mine = wanted.filter((w) => w.title_id === titleId);
    const movie = mine[0].type === "movie";
    const episodes = new Set(mine.filter((w) => w.episode != null).map((w) => key(w.season, w.episode)));
    const names = new Set(mine.map((w) => nameKey(w.name)));
    const dead = all<{ id: number; episode: string | null; label: string | null; url: string }>(
      "SELECT id, episode, label, url FROM links WHERE title_id = ? AND status IN ('failed', 'offline')",
      titleId,
    );
    for (const link of dead) {
      if (movie) {
        revive.push(link.id);
        continue;
      }
      const own = all<{ name: string; season: number | null; episode: number | null }>(
        "SELECT remote_name AS name, season, episode FROM files WHERE link_id = ?",
        link.id,
      );
      const meta = parseEpisode(link.episode) ?? parseEpisode(link.label);
      const eps = own.length
        ? own.filter((f) => f.episode != null).map((f) => key(f.season, f.episode))
        : meta
          ? [key(meta.season, meta.episode)]
          : [];
      const linkNames = own.length ? own.map((f) => f.name) : [link.label, urlName(link.url)].filter((n): n is string => Boolean(n));
      if (eps.some((e) => episodes.has(e)) || linkNames.some((n) => names.has(nameKey(n)))) revive.push(link.id);
    }
  }
  if (revive.length === 0) return 0;
  const ids = revive.map(() => "?").join(",");
  run(
    `UPDATE links SET status = 'new', resolved_at = NULL, error = NULL, attempts = 0, retry_at = NULL, updated_at = ? WHERE id IN (${ids})`,
    now,
    ...revive,
  );
  run(`UPDATE files SET status = 'standby', error = NULL, blocked_notified_at = NULL, updated_at = ? WHERE link_id IN (${ids}) AND status = 'failed'`, now, ...revive);
  logDebug("download", () => `Trying ${revive.length} failed or offline link(s) again for the re-queued episode(s)`, wanted[0].title_id);
  return revive.length;
}

/**
 * Puts files back in line for download: on standby (mirror selection picks the copy to fetch)
 * with their link queued again. Clears a deliberate removal. Links of the same episodes that
 * failed or went offline earlier get another chance (see reviveDeadLinks).
 */
export function requeueFiles(fileIds: number[], now = Date.now()) {
  if (fileIds.length === 0) return;
  reviveDeadLinks(fileIds, now);
  const ids = fileIds.map(() => "?").join(",");
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    run(
      `UPDATE files SET status = 'standby', local_path = NULL, removed_at = NULL, bytes_done = 0, speed_bps = 0, error = NULL,
              attempts = 0, stalls = 0, blocked_notified_at = NULL, updated_at = ? WHERE id IN (${ids})`,
      now,
      ...fileIds,
    );
    run(
      `UPDATE links SET status = 'queued', error = NULL, attempts = 0, retry_at = NULL, updated_at = ?
        WHERE id IN (SELECT link_id FROM files WHERE id IN (${ids})) AND status IN ('done', 'mirror')`,
      now,
      ...fileIds,
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Riparr's own finished downloads whose video file has since vanished from the folder (deleted
 * by hand) go back in the queue, so the episode is fetched again. Files are left alone when
 * another file in the folder covers the same episode (moved or renamed), when the file isn't a
 * video (archives are often deleted after extraction), when the user deleted it through Riparr
 * and chose not to fetch it again, and when the title's root folder is unreachable. Returns the
 * files re-queued. Call after `scanTitle`.
 */
export function requeueMissingDownloads(titleId: number): MissingFile[] {
  const title = getTitle(titleId);
  if (!title || !fs.existsSync(title.root_path)) return [];
  const disk = all<DiskFile>("SELECT * FROM disk_files WHERE title_id = ?", titleId);
  const covered = (f: { season: number | null; episode: number | null }) =>
    title.type === "movie"
      ? disk.length > 0
      : f.episode != null && disk.some((d) => d.episode === f.episode && (d.season ?? 1) === (f.season ?? 1));
  const gone = all<MissingFile & { id: number; local_path: string }>(
    `SELECT f.id, f.remote_name AS name, f.size, f.local_path, f.season, f.episode
       FROM files f JOIN links l ON l.id = f.link_id
      WHERE l.title_id = ? AND f.status IN ('done', 'skipped') AND f.local_path IS NOT NULL AND f.removed_at IS NULL`,
    titleId,
  ).filter((f) => isVideo(f.local_path) && !fs.existsSync(f.local_path) && !covered(f));
  if (gone.length === 0) return [];
  requeueFiles(gone.map((f) => f.id));
  logDebug("scan", () => `Re-queued ${gone.length} missing download(s): ${gone.map((f) => f.name).join(", ")}`, titleId);
  return gone.map(({ name, season, episode, size }) => ({ name, season, episode, size }));
}

/**
 * Brings the database in line with the title's folder: rescans it, then re-queues Riparr's
 * downloads that are gone from it (logged as History activity). Every view reads what's on disk
 * from the scan, so this is the one way the folder's state reaches Riparr. Returns null when the
 * root folder is unreachable (nothing changed).
 */
export function syncFolder(titleId: number, now = Date.now()): { files: DiskFile[]; requeued: MissingFile[] } | null {
  const files = scanTitle(titleId, now);
  if (!files) return null;
  const requeued = requeueMissingDownloads(titleId);
  if (requeued.length) {
    const what = requeued.length === 1 ? requeued[0].name : `${requeued.length} files`;
    logEvent("info", `${what} ${requeued.length === 1 ? "is" : "are"} gone from the folder; downloading again`, titleId, "scan", {
      kind: "files_missing",
      data: { files: requeued, redownload: true },
    });
  }
  return { files, requeued };
}

/**
 * Adds a file Riparr just downloaded to the folder's scan results, so it counts as on disk
 * straight away rather than at the next rescan. Non-video files and files outside the title's
 * folder are ignored, as a scan would.
 */
export function recordDownload(titleId: number, filePath: string) {
  const title = getTitle(titleId);
  if (!title || !isVideo(filePath)) return;
  const folder = path.join(title.root_path, title.folder);
  if (!filePath.startsWith(folder + path.sep) || filePath.slice(folder.length + 1).split(path.sep).some((p) => p.startsWith("."))) return;
  let st: fs.Stats;
  try {
    st = fs.statSync(filePath);
  } catch {
    return;
  }
  const ep = diskEpisode(filePath, title.type);
  run(
    `INSERT INTO disk_files (title_id, path, size, season, episode, mtime) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (title_id, path) DO UPDATE SET size = excluded.size, season = excluded.season, episode = excluded.episode, mtime = excluded.mtime`,
    titleId,
    filePath,
    st.size,
    ep.season,
    ep.episode,
    Math.round(st.mtimeMs),
  );
}

/**
 * Files in the title's folder that Riparr didn't download itself: no finished
 * download of the title points at them. Pending copies of their episodes
 * aren't downloaded (see coveredByDisk).
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

/** "3 video files: 2 downloaded by Riparr, 1 added by hand", for the log. */
export function describeScan(titleId: number, files: DiskFile[]): string {
  if (files.length === 0) return "no video files";
  const external = externalDiskFiles(titleId).length;
  const own = files.length - external;
  const parts = [own ? `${own} downloaded by Riparr` : null, external ? `${external} added by hand` : null].filter(Boolean);
  return `${files.length} video file${files.length === 1 ? "" : "s"} (${parts.join(", ")})`;
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
