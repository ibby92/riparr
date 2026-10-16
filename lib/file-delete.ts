import fs from "node:fs";
import path from "node:path";
import { all, getDb, one, run } from "./db";
import { diskEpisode, isVideo, requeueFiles, type MissingFile } from "./disk-scan";
import { getTitle, type TitleType } from "./titles";

export type DeleteResult = { ok: true; file: MissingFile; requeued: number } | { ok: false; error: string };

type Copy = { id: number; status: string; local_path: string | null; remote_name: string };

/**
 * Riparr's copies (on any host) of the episode a file in the folder holds: for shows, same
 * season and episode; for movies, every video file. A file without an episode number has none.
 */
function episodeCopies(titleId: number, type: TitleType, ep: { season: number | null; episode: number | null }): Copy[] {
  const rows = all<Copy & { season: number | null; episode: number | null }>(
    `SELECT f.id, f.status, f.local_path, f.remote_name, f.season, f.episode FROM files f JOIN links l ON l.id = f.link_id
      WHERE l.title_id = ?`,
    titleId,
  );
  if (type === "movie") return rows.filter((f) => isVideo(f.remote_name));
  if (ep.episode == null) return [];
  return rows.filter((f) => f.episode === ep.episode && (f.season ?? 1) === (ep.season ?? 1));
}

/**
 * Deletes one video file from a title's folder. Only files Riparr already knows about are
 * accepted (its own downloads and the folder-scan results), and only inside the title's folder,
 * so a forged path can't reach anything else.
 *
 * With `redownload`, the episode goes back in the queue. Otherwise every copy of it is marked
 * removed: it no longer counts as on disk, and Riparr doesn't fetch it again until asked
 * (`restoreEpisode`).
 */
export function deleteTitleFile(titleId: number, filePath: string, redownload: boolean, now = Date.now()): DeleteResult {
  const title = getTitle(titleId);
  if (!title) return { ok: false, error: "Title no longer exists" };
  const folder = path.join(title.root_path, title.folder);
  const target = path.resolve(filePath);
  if (!target.startsWith(folder + path.sep)) return { ok: false, error: "That file isn't in the title's folder" };

  const scanned = one<{ size: number; season: number | null; episode: number | null }>(
    "SELECT size, season, episode FROM disk_files WHERE title_id = ? AND path = ?",
    titleId,
    target,
  );
  const pointing = all<Copy & { size: number | null }>(
    "SELECT f.id, f.status, f.local_path, f.remote_name, f.size FROM files f JOIN links l ON l.id = f.link_id WHERE l.title_id = ? AND f.local_path = ?",
    titleId,
    target,
  );
  if (!scanned && pointing.length === 0) return { ok: false, error: "Riparr doesn't know that file; rescan the folder first" };

  try {
    // Resolve symlinks in the directory part so a link can't lead out of the folder.
    const realDir = fs.realpathSync(path.dirname(target));
    if (!(realDir + path.sep).startsWith(fs.realpathSync(folder) + path.sep)) {
      return { ok: false, error: "That file isn't in the title's folder" };
    }
    fs.rmSync(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      return { ok: false, error: `Couldn't delete the file: ${(err as Error).message}` };
    }
  }

  const ep = scanned ?? diskEpisode(target, title.type);
  const file: MissingFile = { name: path.basename(target), season: ep.season, episode: ep.episode, size: scanned?.size ?? pointing[0]?.size ?? null };
  // Other copies of the episode, except finished downloads still in the folder under another name.
  const others = episodeCopies(titleId, title.type, ep).filter(
    (f) => f.local_path !== target && f.status !== "downloading" && !(f.status === "done" && f.local_path && fs.existsSync(f.local_path)),
  );

  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    run("DELETE FROM disk_files WHERE title_id = ? AND path = ?", titleId, target);
    if (!redownload) {
      // Kept as handled (skipped) so mirror selection doesn't pick another copy, but not on disk.
      const ids = [...pointing.map((f) => f.id), ...others.map((f) => f.id)];
      if (ids.length) {
        run(
          `UPDATE files SET status = 'skipped', local_path = NULL, removed_at = ?, bytes_done = 0, speed_bps = 0, error = NULL, updated_at = ?
            WHERE id IN (${ids.map(() => "?").join(",")})`,
          now,
          now,
          ...ids,
        );
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  if (!redownload) return { ok: true, file, requeued: 0 };
  // The deleted copy, and copies that were skipped because this file covered the episode.
  const requeue = [...pointing, ...others.filter((f) => f.status === "skipped")].map((f) => f.id);
  requeueFiles(requeue, now);
  return { ok: true, file, requeued: requeue.length };
}

/** Queues an episode (or a movie, `episode` null) deleted earlier through Riparr for download again. Returns the copies queued. */
export function restoreEpisode(titleId: number, season: number | null, episode: number | null): number {
  const title = getTitle(titleId);
  if (!title) return 0;
  const ids = all<{ id: number; season: number | null; episode: number | null; remote_name: string }>(
    `SELECT f.id, f.season, f.episode, f.remote_name FROM files f JOIN links l ON l.id = f.link_id
      WHERE l.title_id = ? AND f.removed_at IS NOT NULL`,
    titleId,
  )
    .filter((f) => (title.type === "movie" ? isVideo(f.remote_name) : f.episode === episode && (f.season ?? 1) === (season ?? 1)))
    .map((f) => f.id);
  requeueFiles(ids);
  return ids.length;
}
