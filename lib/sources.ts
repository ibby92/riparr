import { z } from "zod";
import { all, one, run } from "./db";
import type { SourceStatus } from "./titles";

/** A container page (link protector, paste page…) that supplies links for a title. */
export type Source = {
  id: number;
  title_id: number;
  url: string;
  password: string | null;
  poll_interval_min: number;
  enabled: number;
  poll: number;
  status: SourceStatus;
  last_error: string | null;
  last_checked_at: number | null;
  last_changed_at: number | null;
  next_check_at: number;
  created_at: number;
};

/** A source joined with what the worker needs about its title. */
export type SourceWithTitle = Source & { title_name: string; monitored: number; link_count: number };

const bool = z.preprocess((v) => v === true || v === "on" || v === "true" || v === 1 || v === "1", z.boolean());

export const sourceInput = z.object({
  url: z
    .string()
    .trim()
    .pipe(z.url({ protocol: /^https?$/, error: "Must be an http(s) URL" })),
  password: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().nullable()),
  poll_interval_min: z.coerce
    .number<string>()
    .int()
    .min(5, "Poll at most every 5 minutes")
    .max(7 * 24 * 60, "Poll at least once a week")
    .default(60),
  enabled: bool.default(true),
  poll: bool.default(true),
});

export type SourceInput = z.infer<typeof sourceInput>;

const WITH_TITLE = `
  SELECT s.*, t.name AS title_name, t.monitored,
         (SELECT COUNT(*) FROM links l WHERE l.source_id = s.id) AS link_count
    FROM sources s JOIN titles t ON t.id = s.title_id`;

export function listSources(titleId?: number): SourceWithTitle[] {
  return titleId === undefined
    ? all<SourceWithTitle>(`${WITH_TITLE} ORDER BY t.name COLLATE NOCASE, s.id`)
    : all<SourceWithTitle>(`${WITH_TITLE} WHERE s.title_id = ? ORDER BY s.id`, titleId);
}

export function getSource(id: number): SourceWithTitle | undefined {
  return one<SourceWithTitle>(`${WITH_TITLE} WHERE s.id = ?`, id);
}

export function findSourceByUrl(url: string): Source | undefined {
  return one<Source>("SELECT * FROM sources WHERE url = ?", url);
}

export function createSource(titleId: number, input: SourceInput): number {
  const result = run(
    `INSERT INTO sources (title_id, url, password, poll_interval_min, enabled, poll, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    titleId,
    input.url,
    input.password,
    input.poll_interval_min,
    input.enabled ? 1 : 0,
    input.poll ? 1 : 0,
    Date.now(),
  );
  return Number(result.lastInsertRowid);
}

/**
 * Saves a source. A new URL (e.g. a fresh link for an expired page) starts
 * over: status back to pending, the old error cleared, and due for a check
 * right away. Returns whether the URL changed.
 */
export function updateSource(id: number, input: SourceInput): { urlChanged: boolean } {
  const before = one<{ url: string }>("SELECT url FROM sources WHERE id = ?", id);
  const urlChanged = before !== undefined && before.url !== input.url;
  run(
    "UPDATE sources SET url = ?, password = ?, poll_interval_min = ?, enabled = ?, poll = ? WHERE id = ?",
    input.url,
    input.password,
    input.poll_interval_min,
    input.enabled ? 1 : 0,
    input.poll ? 1 : 0,
    id,
  );
  if (urlChanged) run("UPDATE sources SET status = 'pending', last_error = NULL, next_check_at = 0 WHERE id = ?", id);
  return { urlChanged };
}

/** Removes the source. Links it found stay with the title. */
export function deleteSource(id: number) {
  run("DELETE FROM sources WHERE id = ?", id);
}

export function setSourceEnabled(id: number, enabled: boolean) {
  run("UPDATE sources SET enabled = ? WHERE id = ?", enabled ? 1 : 0, id);
}

/** Sources due for a check: enabled, polled, belonging to a monitored title. Oldest first. */
export function dueSources(now = Date.now()): SourceWithTitle[] {
  return all<SourceWithTitle>(
    `${WITH_TITLE}
      WHERE s.enabled = 1 AND s.poll = 1 AND t.monitored = 1 AND s.next_check_at <= ?
      ORDER BY s.next_check_at`,
    now,
  );
}

export function scheduleCheckNow(id: number) {
  run("UPDATE sources SET next_check_at = 0 WHERE id = ?", id);
}

/** Checks every polled source of a title as soon as possible. */
export function scheduleTitleCheckNow(titleId: number) {
  run("UPDATE sources SET next_check_at = 0 WHERE title_id = ? AND enabled = 1 AND poll = 1", titleId);
}

export function recordCheck(
  id: number,
  result: { status: SourceStatus; error?: string | null; changed: boolean; nextCheckAt: number },
) {
  const now = Date.now();
  run(
    `UPDATE sources
        SET status = ?, last_error = ?, last_checked_at = ?, next_check_at = ?,
            last_changed_at = CASE WHEN ? THEN ? ELSE last_changed_at END
      WHERE id = ?`,
    result.status,
    result.error ?? null,
    now,
    result.nextCheckAt,
    result.changed ? 1 : 0,
    now,
    id,
  );
}

/** Passwords set on a title's sources (for gofile folders and archives), most recent first. */
export function titlePasswords(titleId: number): string[] {
  return all<{ password: string }>(
    "SELECT DISTINCT password FROM sources WHERE title_id = ? AND password IS NOT NULL ORDER BY id DESC",
    titleId,
  ).map((r) => r.password);
}
