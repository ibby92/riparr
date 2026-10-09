import { all, getDb, one, run } from "./db";
import { hostIdFor, normalizeLinkUrl } from "./hosts";

export type LinkStatus = "new" | "queued" | "resolving" | "downloading" | "done" | "failed" | "ignored" | "offline";
export type FileStatus = "queued" | "downloading" | "done" | "failed" | "skipped";

export type Link = {
  id: number;
  container_id: number;
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
};

export type LinkWithProgress = Link & {
  container_name: string;
  /** Combined speed of the link's files that are downloading right now. */
  speed_bps: number;
  file_count: number;
  files_done: number;
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
};

/**
 * Stores newly discovered links. Already-known links are ignored. Returns how many were new.
 * `archivePassword` (e.g. from Click'n'Load) is kept for extraction.
 */
export function addLinks(containerId: number, urls: string[], archivePassword: string | null = null): number {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO links (container_id, url, fingerprint, host, discovered_at, updated_at, archive_password)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (container_id, fingerprint) DO NOTHING`,
  );
  const now = Date.now();
  let added = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const url of urls) {
      const result = insert.run(containerId, url, normalizeLinkUrl(url), hostIdFor(url), now, now, archivePassword);
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
  SELECT l.*, c.name AS container_name,
         COUNT(f.id) AS file_count,
         COALESCE(SUM(f.status IN ('done', 'skipped')), 0) AS files_done,
         COALESCE(SUM(f.bytes_done), 0) AS bytes_done,
         COALESCE(SUM(CASE WHEN f.status = 'downloading' THEN f.speed_bps ELSE 0 END), 0) AS speed_bps,
         CASE WHEN COUNT(f.id) = 0 OR COUNT(f.size) < COUNT(f.id) THEN NULL ELSE SUM(f.size) END AS bytes_total
    FROM links l
    JOIN containers c ON c.id = l.container_id
    LEFT JOIN files f ON f.link_id = l.id`;

export function listLinks(containerId: number): LinkWithProgress[] {
  return all<LinkWithProgress>(
    `${WITH_PROGRESS} WHERE l.container_id = ? GROUP BY l.id ORDER BY l.discovered_at DESC, l.id DESC`,
    containerId,
  );
}

/** Links that are in flight or waiting, for the queue page. */
export function activeLinks(): LinkWithProgress[] {
  return all<LinkWithProgress>(
    `${WITH_PROGRESS}
      WHERE l.status IN ('new', 'queued', 'resolving', 'downloading')
      GROUP BY l.id
      ORDER BY l.status = 'downloading' DESC, l.status = 'resolving' DESC, l.discovered_at, l.id`,
  );
}

export function recentlyFinishedLinks(limit = 50): LinkWithProgress[] {
  return all<LinkWithProgress>(
    `${WITH_PROGRESS}
      WHERE l.status IN ('done', 'failed', 'offline')
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

/** Links of a container that are still waiting or in flight. */
export function pendingLinkCount(containerId: number): number {
  return (
    one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM links WHERE container_id = ? AND status IN ('new', 'queued', 'resolving', 'downloading')",
      containerId,
    )?.n ?? 0
  );
}

/** Links ready to process: new, or queued with no pending retry delay, in enabled containers. */
export function claimableLinks(now = Date.now(), limit = 100): Link[] {
  return all<Link>(
    `SELECT l.* FROM links l JOIN containers c ON c.id = l.container_id
      WHERE c.enabled = 1 AND l.status IN ('new', 'queued') AND (l.retry_at IS NULL OR l.retry_at <= ?)
      ORDER BY l.discovered_at, l.id LIMIT ?`,
    now,
    limit,
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

/** User-initiated retry: clears attempts and backoff. */
export function requeueLink(id: number) {
  run(
    "UPDATE links SET status = 'queued', error = NULL, attempts = 0, retry_at = NULL, updated_at = ? WHERE id = ?",
    Date.now(),
    id,
  );
  run("UPDATE files SET status = 'queued', error = NULL WHERE link_id = ? AND status = 'failed'", id);
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
): FileRow[] {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO files (link_id, key, remote_name, dir, size, hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (link_id, key) DO UPDATE
        SET remote_name = excluded.remote_name, dir = excluded.dir,
            size = excluded.size, hash = excluded.hash`,
  );
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const f of files) upsert.run(linkId, f.key, f.name, f.dir, f.size, f.hash, now);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return listFiles(linkId);
}

export function updateFile(
  id: number,
  patch: Partial<Pick<FileRow, "status" | "bytes_done" | "local_path" | "error" | "attempts" | "speed_bps">>,
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

export function listExtractions(containerId: number): ExtractionRow[] {
  return all<ExtractionRow>(
    "SELECT id, entry_path, status, error, files, updated_at FROM extractions WHERE container_id = ? ORDER BY updated_at DESC",
    containerId,
  );
}
