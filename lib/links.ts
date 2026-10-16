import { all, getDb, one, run } from "./db";
import type { LinkMeta } from "./crawlers/types";
import { parseEpisode, type EpisodeRef } from "./episodes";
import { hostIdFor, normalizeLinkUrl } from "./hosts";

export type LinkStatus =
  | "new"
  | "queued"
  | "resolving"
  | "downloading"
  | "done"
  | "failed"
  | "ignored"
  | "offline"
  /** Every file of this link came from a more preferred host instead. */
  | "mirror";
/** `standby`: an identical file on a more preferred host is (or was) being used instead. */
export type FileStatus = "queued" | "downloading" | "done" | "failed" | "skipped" | "standby";

export type Link = {
  id: number;
  title_id: number;
  /** The source that first listed this link; null if that source was removed. */
  source_id: number | null;
  url: string;
  fingerprint: string;
  host: string;
  status: LinkStatus;
  error: string | null;
  attempts: number;
  retry_at: number | null;
  discovered_at: number;
  updated_at: number | null;
  archive_password: string | null;
  /** When the link's files became known; null until first resolved. */
  resolved_at: number | null;
  /** Details the source published for this link, if any. */
  label: string | null;
  episode: string | null;
  quality: string | null;
  size_text: string | null;
};

export type LinkWithProgress = Link & {
  title_name: string;
  /** Combined speed of the link's files that are downloading right now. */
  speed_bps: number;
  file_count: number;
  files_done: number;
  /** Files held back because another host is preferred for them. */
  files_standby: number;
  bytes_done: number;
  bytes_total: number | null;
};

export type FileRow = {
  id: number;
  link_id: number;
  key: string;
  remote_name: string;
  dir: string;
  size: number | null;
  hash: string | null;
  local_path: string | null;
  bytes_done: number;
  status: FileStatus;
  attempts: number;
  error: string | null;
  updated_at: number;
  speed_bps: number;
  season: number | null;
  episode: number | null;
  /** Consecutive stalled attempts; reset when the file finishes. */
  stalls: number;
  /** When the user was told no working copy of this file is left; null if never. */
  blocked_notified_at: number | null;
  /** When the user deleted this file from the folder and chose not to download it again (status 'skipped'). */
  removed_at: number | null;
};

/**
 * Stores newly discovered links. Already-known links are ignored. Returns how many were new.
 * `archivePassword` (e.g. from Click'n'Load) is kept for extraction.
 */
export function addLinks(
  titleId: number,
  sourceId: number | null,
  urls: string[],
  archivePassword: string | null = null,
  meta: LinkMeta[] = [],
): number {
  const db = getDb();
  const byUrl = new Map(meta.map((m) => [m.url, m]));
  const insert = db.prepare(
    `INSERT INTO links (title_id, source_id, url, fingerprint, host, discovered_at, updated_at, archive_password,
                        label, episode, quality, size_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (title_id, fingerprint) DO NOTHING`,
  );
  const now = Date.now();
  let added = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const url of urls) {
      const m = byUrl.get(url);
      const result = insert.run(
        titleId,
        sourceId,
        url,
        normalizeLinkUrl(url),
        hostIdFor(url),
        now,
        now,
        archivePassword,
        m?.label ?? null,
        m?.episode ?? null,
        m?.quality ?? null,
        m?.size ?? null,
      );
      added += Number(result.changes);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return added;
}

const WITH_PROGRESS = `
  SELECT l.*, t.name AS title_name,
         COUNT(f.id) AS file_count,
         COALESCE(SUM(f.status IN ('done', 'skipped')), 0) AS files_done,
         COALESCE(SUM(f.status = 'standby'), 0) AS files_standby,
         COALESCE(SUM(f.bytes_done), 0) AS bytes_done,
         COALESCE(SUM(CASE WHEN f.status = 'downloading' THEN f.speed_bps ELSE 0 END), 0) AS speed_bps,
         CASE WHEN COUNT(f.id) = 0 OR COUNT(f.size) < COUNT(f.id) THEN NULL ELSE SUM(f.size) END AS bytes_total
    FROM links l
    JOIN titles t ON t.id = l.title_id
    LEFT JOIN files f ON f.link_id = l.id`;

export function listLinks(titleId: number): LinkWithProgress[] {
  return all<LinkWithProgress>(
    `${WITH_PROGRESS} WHERE l.title_id = ? GROUP BY l.id ORDER BY l.discovered_at DESC, l.id DESC`,
    titleId,
  );
}

/** Links that are in flight or waiting, for the queue page. */
export function activeLinks(): LinkWithProgress[] {
  // Archived titles' leftover links stay put but aren't part of the queue.
  return all<LinkWithProgress>(
    `${WITH_PROGRESS}
      WHERE l.status IN ('new', 'queued', 'resolving', 'downloading') AND t.archived_at IS NULL
      GROUP BY l.id
      ORDER BY l.status = 'downloading' DESC, l.status = 'resolving' DESC, l.discovered_at, l.id`,
  );
}

export function recentlyFinishedLinks(limit = 50): LinkWithProgress[] {
  return all<LinkWithProgress>(
    `${WITH_PROGRESS}
      WHERE l.status IN ('done', 'failed', 'offline', 'mirror')
      GROUP BY l.id
      ORDER BY l.updated_at DESC LIMIT ?`,
    limit,
  );
}

export function getLink(id: number): Link | undefined {
  return one<Link>("SELECT * FROM links WHERE id = ?", id);
}

export function listFiles(linkId: number): FileRow[] {
  return all<FileRow>("SELECT * FROM files WHERE link_id = ? ORDER BY dir, remote_name", linkId);
}

/** Combined speed of everything downloading right now (bytes/second). */
export function totalSpeed(): number {
  return one<{ s: number }>("SELECT COALESCE(SUM(speed_bps), 0) AS s FROM files WHERE status = 'downloading'")?.s ?? 0;
}

/** Links of a title that are still waiting or in flight. */
export function pendingLinkCount(titleId: number): number {
  return (
    one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM links WHERE title_id = ? AND status IN ('new', 'queued', 'resolving', 'downloading')",
      titleId,
    )?.n ?? 0
  );
}

const READY = `t.monitored = 1 AND l.status IN ('new', 'queued') AND (l.retry_at IS NULL OR l.retry_at <= ?)`;

/** Links whose files aren't known yet and are ready to be resolved. */
export function unresolvedLinks(now = Date.now(), limit = 100): Link[] {
  return all<Link>(
    `SELECT l.* FROM links l JOIN titles t ON t.id = l.title_id
      WHERE ${READY} AND l.resolved_at IS NULL
      ORDER BY l.discovered_at, l.id LIMIT ?`,
    now,
    limit,
  );
}

/** Resolved links with at least one file chosen for download. */
export function downloadableLinks(now = Date.now(), limit = 100): Link[] {
  return all<Link>(
    `SELECT l.* FROM links l JOIN titles t ON t.id = l.title_id
      WHERE ${READY} AND l.resolved_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM files f WHERE f.link_id = l.id AND f.status = 'queued')
      ORDER BY l.discovered_at, l.id LIMIT ?`,
    now,
    limit,
  );
}

export function markResolved(id: number) {
  run("UPDATE links SET resolved_at = ?, status = 'queued', error = NULL, attempts = 0, retry_at = NULL, updated_at = ? WHERE id = ?", Date.now(), Date.now(), id);
}

/** Links of a title not resolved yet (new, or waiting to retry resolving): they may still add copies. */
export function unresolvedLinkCount(titleId: number): number {
  return (
    one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM links WHERE title_id = ? AND resolved_at IS NULL AND status IN ('new', 'queued', 'resolving')",
      titleId,
    )?.n ?? 0
  );
}

/** Titles with links still in play, i.e. where mirror selection may have work. */
export function titlesWithActiveLinks(): number[] {
  return all<{ id: number }>(
    "SELECT DISTINCT title_id AS id FROM links WHERE status IN ('new', 'queued', 'resolving', 'downloading')",
  ).map((r) => r.id);
}

/** True while freshly found links of the title are still being resolved; selection waits for them. */
export function resolvingInProgress(titleId: number): boolean {
  return (
    (one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM links WHERE title_id = ? AND resolved_at IS NULL AND status IN ('new', 'resolving')",
      titleId,
    )?.n ?? 0) > 0
  );
}

export type TitleFile = {
  fileId: number;
  linkId: number;
  host: string;
  name: string;
  dir: string;
  size: number | null;
  fileStatus: FileStatus;
  linkStatus: LinkStatus;
  linkDiscoveredAt: number;
  linkRetryAt: number | null;
  linkResolvedAt: number | null;
  fileStalls: number;
  blockedNotifiedAt: number | null;
  season: number | null;
  episode: number | null;
};

/** Every file of a title (across all its sources) with its link's state, for mirror selection and settling. */
export function titleFiles(titleId: number): TitleFile[] {
  return all<TitleFile>(
    `SELECT f.id AS fileId, l.id AS linkId, l.host, f.remote_name AS name, f.dir, f.size,
            f.status AS fileStatus, l.status AS linkStatus, l.discovered_at AS linkDiscoveredAt,
            l.retry_at AS linkRetryAt, l.resolved_at AS linkResolvedAt,
            f.stalls AS fileStalls, f.blocked_notified_at AS blockedNotifiedAt, f.season, f.episode
       FROM files f JOIN links l ON l.id = f.link_id
      WHERE l.title_id = ?`,
    titleId,
  );
}

export function setFileStatuses(ids: number[], status: FileStatus) {
  if (ids.length === 0) return;
  run(
    `UPDATE files SET status = ?, updated_at = ? WHERE id IN (${ids.map(() => "?").join(",")})`,
    status,
    Date.now(),
    ...ids,
  );
}

/** Queues the settled (done or mirror) links of these files again, so their queued files download. */
export function requeueSettledLinks(fileIds: number[]) {
  if (fileIds.length === 0) return;
  run(
    `UPDATE links SET status = 'queued', error = NULL, attempts = 0, retry_at = NULL, updated_at = ?
      WHERE status IN ('done', 'mirror') AND id IN (SELECT link_id FROM files WHERE id IN (${fileIds.map(() => "?").join(",")}))`,
    Date.now(),
    ...fileIds,
  );
}

/** A permanently failed/offline link gives up its files so other hosts' copies can be used. */
export function failLinkFiles(linkId: number, error: string) {
  run(
    "UPDATE files SET status = 'failed', error = ?, speed_bps = 0, updated_at = ? WHERE link_id = ? AND status IN ('queued', 'standby', 'downloading')",
    error,
    Date.now(),
    linkId,
  );
}

/** A link that will be retried later parks its unfinished files so another host may step in meanwhile. */
export function parkLinkFiles(linkId: number) {
  run(
    "UPDATE files SET status = 'standby', speed_bps = 0, updated_at = ? WHERE link_id = ? AND status IN ('queued', 'downloading', 'failed')",
    Date.now(),
    linkId,
  );
}

export function setLinkStatus(
  id: number,
  status: LinkStatus,
  extra: { error?: string | null; attempts?: number; retryAt?: number | null } = {},
) {
  run(
    `UPDATE links
        SET status = ?, error = ?, updated_at = ?,
            attempts = COALESCE(?, attempts),
            retry_at = ?
      WHERE id = ?`,
    status,
    extra.error ?? null,
    Date.now(),
    extra.attempts ?? null,
    extra.retryAt ?? null,
    id,
  );
}

/** User-initiated retry: clears attempts and backoff; mirror selection then re-decides its files. */
export function requeueLink(id: number) {
  run(
    "UPDATE links SET status = 'queued', error = NULL, attempts = 0, retry_at = NULL, updated_at = ? WHERE id = ?",
    Date.now(),
    id,
  );
  run("UPDATE files SET status = 'standby', error = NULL WHERE link_id = ? AND status = 'failed'", id);
}

/** Puts work interrupted by a crash or shutdown back in the queue. */
export function recoverInterrupted() {
  run("UPDATE links SET status = 'queued' WHERE status IN ('resolving', 'downloading')");
  run("UPDATE files SET status = 'queued' WHERE status = 'downloading'");
}

/** Records the files behind a link, keeping existing rows (and their progress) for known keys. */
export function upsertFiles(
  linkId: number,
  files: { key: string; name: string; dir: string; size: number | null; hash: string | null }[],
  /** Episode from the link's own details, used when a file name has none. */
  fallbackEpisode: EpisodeRef | null = null,
): FileRow[] {
  const db = getDb();
  // New files start on standby; mirror selection decides which copy downloads.
  const upsert = db.prepare(
    `INSERT INTO files (link_id, key, remote_name, dir, size, hash, updated_at, status, season, episode)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'standby', ?, ?)
     ON CONFLICT (link_id, key) DO UPDATE
        SET remote_name = excluded.remote_name, dir = excluded.dir,
            size = excluded.size, hash = excluded.hash,
            season = excluded.season, episode = excluded.episode`,
  );
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const f of files) {
      // Single-file links take the link's episode; folder files need their own marker.
      const ep = parseEpisode(f.name) ?? (files.length === 1 ? fallbackEpisode : null);
      upsert.run(linkId, f.key, f.name, f.dir, f.size, f.hash, now, ep?.season ?? null, ep?.episode ?? null);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return listFiles(linkId);
}

export function updateFile(
  id: number,
  patch: Partial<Pick<FileRow, "status" | "bytes_done" | "local_path" | "error" | "attempts" | "speed_bps" | "stalls" | "blocked_notified_at">>,
) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.length === 0) return;
  run(
    `UPDATE files SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
    ...keys.map((k) => patch[k] ?? null),
    Date.now(),
    id,
  );
}

export type ExtractionRow = {
  id: number;
  entry_path: string;
  status: "extracted" | "incomplete" | "wrong_password" | "failed";
  error: string | null;
  files: number;
  updated_at: number;
};

export function listExtractions(titleId: number): ExtractionRow[] {
  return all<ExtractionRow>(
    "SELECT id, entry_path, status, error, files, updated_at FROM extractions WHERE title_id = ? ORDER BY updated_at DESC",
    titleId,
  );
}
