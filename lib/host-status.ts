import { all, one, run } from "./db";
import type { RateLimitError } from "./errors";
import { logDebug, logEvent } from "./events";
import { dateTime, localDay, localDayBefore } from "./time";
import { KNOWN_HOSTS } from "./host-ids";
import { notify } from "./notify";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Limits at least this long pause the whole host. Shorter ones (pixeldrain's
 * concurrent-download cap, a 429 without Retry-After) are usually about one
 * request burst, so they stay on the link and don't flap the host's state.
 */
export const HOST_COOLDOWN_MIN_MS = 2 * MINUTE;
/** One continuous limited episode this long triggers a needs_attention notification. */
export const LONG_LIMIT_MS = 6 * HOUR;
/** A new limit within this long after the last one ended continues the same episode. */
const EPISODE_GAP_MS = 15 * MINUTE;
/** Errors newer than this, and newer than the last success, show a host as "errors". */
export const ERROR_WINDOW_MS = HOUR;

/** Time source for scheduling (retries, cooldowns, usage day). Tests move it forward. */
export const clock = { now: () => Date.now() };

export type HostLimit = {
  host: string;
  until: number;
  reason: string;
  /** Start of this limited episode (stays put while the limit is extended). */
  since: number;
};

type HostStatusRow = {
  host: string;
  limited_until: number | null;
  limit_reason: string | null;
  limited_since: number | null;
  limit_notified_at: number | null;
  last_ok_at: number | null;
  last_error_at: number | null;
  last_error: string | null;
};

export function hostLabel(host: string): string {
  return KNOWN_HOSTS.find((h) => h.id === host)?.label ?? host;
}

/** Human reason for a host-wide limit, e.g. "MEGA transfer quota". */
export function limitReason(host: string, err: RateLimitError): string {
  const msg = err.message;
  if (host === "pixeldrain") {
    // pixeldrain's own message may replace the error code, so the hour-long wait identifies the cap too.
    if (/transfer|download.?limit|bandwidth/i.test(msg) || err.retryAfterMs >= HOUR) return "pixeldrain daily transfer limit";
    if (/overload/i.test(msg)) return "pixeldrain server overload";
  }
  if (host === "mega" && /quota|bandwidth|509/i.test(msg)) return "MEGA transfer quota";
  return `${hostLabel(host)} rate limit`;
}

function statusRow(host: string) {
  return one<HostStatusRow>("SELECT * FROM host_status WHERE host = ?", host);
}

function toLimit(r: HostStatusRow): HostLimit {
  return { host: r.host, until: r.limited_until!, reason: r.limit_reason ?? "rate limit", since: r.limited_since ?? r.limited_until! };
}

/** Hosts cooling down right now, soonest reset first. */
export function activeHostLimits(now = clock.now()): HostLimit[] {
  return all<HostStatusRow>("SELECT * FROM host_status WHERE limited_until > ? ORDER BY limited_until, host", now).map(toLimit);
}

export function hostLimit(host: string, now = clock.now()): HostLimit | null {
  const r = statusRow(host);
  return r?.limited_until != null && r.limited_until > now ? toLimit(r) : null;
}

/**
 * Pending links on a limited host wait until the reset: they don't resolve or
 * download, and mirror selection sees them as waiting so other hosts step in.
 * Unresolved links move from new to queued so they don't hold up selection.
 */
export function holdHostLinks(host: string, until: number) {
  run(
    `UPDATE links SET status = 'queued', retry_at = ?, updated_at = ?
      WHERE host = ? AND status IN ('new', 'queued') AND (retry_at IS NULL OR retry_at < ?)`,
    until,
    Date.now(),
    host,
    until,
  );
}

/** Re-applies active cooldowns, catching links found or requeued since the limit began. */
export function holdLimitedHosts(now = clock.now()) {
  for (const l of activeHostLimits(now)) holdHostLinks(l.host, l.until);
}

/**
 * Records a host-wide cooldown (extending, never shortening, a current one) and
 * holds the host's pending links. `fresh` is true when the host wasn't limited a moment ago.
 */
export function recordHostLimit(host: string, until: number, reason: string, now = clock.now()) {
  const row = statusRow(host);
  const fresh = !(row?.limited_until != null && row.limited_until > now);
  const continuing = row?.limited_until != null && row.limited_until + EPISODE_GAP_MS >= now;
  const newUntil = continuing ? Math.max(row.limited_until!, until) : until;
  run(
    `INSERT INTO host_status (host, limited_until, limit_reason, limited_since, limit_notified_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (host) DO UPDATE SET limited_until = ?2, limit_reason = ?3, limited_since = ?4, limit_notified_at = ?5`,
    host,
    newUntil,
    reason,
    continuing ? (row!.limited_since ?? now) : now,
    continuing ? (row!.limit_notified_at ?? null) : null,
  );
  holdHostLinks(host, newUntil);
  logDebug(
    "host",
    () => `${hostLabel(host)} ${fresh ? "limited" : continuing ? "limit extended" : "limited again"} until ${dateTime(newUntil)} (${reason})`,
  );
  return { until: newUntil, fresh };
}

/** A request to the host worked. Once its reset time has passed, that ends the cooldown. */
export function recordHostOk(host: string, now = clock.now()) {
  const before = statusRow(host);
  run(
    `INSERT INTO host_status (host, last_ok_at) VALUES (?1, ?2)
     ON CONFLICT (host) DO UPDATE SET last_ok_at = ?2,
       limited_since     = CASE WHEN limited_until <= ?2 THEN NULL ELSE limited_since END,
       limit_reason      = CASE WHEN limited_until <= ?2 THEN NULL ELSE limit_reason END,
       limit_notified_at = CASE WHEN limited_until <= ?2 THEN NULL ELSE limit_notified_at END,
       limited_until     = CASE WHEN limited_until <= ?2 THEN NULL ELSE limited_until END`,
    host,
    now,
  );
  if (before?.limited_until != null && before.limited_until <= now) {
    logEvent("info", `${hostLabel(host)} limit has ended; its downloads resume`, null, "host", { kind: "host_limit_ended", data: { host } });
  }
}

/** A request failed for a reason other than a limit or a missing file (stalls, server errors, captchas). */
export function recordHostError(host: string, message: string, now = clock.now()) {
  logDebug("host", `${hostLabel(host)} error: ${message}`);
  run(
    `INSERT INTO host_status (host, last_error_at, last_error) VALUES (?1, ?2, ?3)
     ON CONFLICT (host) DO UPDATE SET last_error_at = ?2, last_error = ?3`,
    host,
    now,
    message,
  );
}

/** Ends a cooldown now (user "retry now") and releases the links it held. */
export function clearHostLimit(host: string) {
  const row = statusRow(host);
  if (row?.limited_until == null) return;
  logEvent("info", `${hostLabel(host)} limit cleared by hand (it was set until ${dateTime(row.limited_until)}); retrying its downloads`, null, "host", {
    kind: "host_limit_ended",
    data: { host },
  });
  run(
    "UPDATE links SET retry_at = NULL, updated_at = ? WHERE host = ? AND status = 'queued' AND retry_at IS NOT NULL AND retry_at <= ?",
    Date.now(),
    host,
    row.limited_until,
  );
  run(
    "UPDATE host_status SET limited_until = NULL, limit_reason = NULL, limited_since = NULL, limit_notified_at = NULL WHERE host = ?",
    host,
  );
}

// Day keys follow the configured time zone (lib/time.ts). Rows written before v1.1 used UTC days.
export { localDay, localDayBefore } from "./time";

export function addHostUsage(host: string, bytes: number, now = clock.now()) {
  if (!(bytes > 0)) return;
  run(
    `INSERT INTO host_usage (host, day, bytes) VALUES (?1, ?2, ?3)
     ON CONFLICT (host, day) DO UPDATE SET bytes = bytes + ?3`,
    host,
    localDay(now),
    Math.round(bytes),
  );
}

/** Bytes downloaded per host today (local time). */
export function usageToday(now = clock.now()): Map<string, number> {
  return new Map(all<{ host: string; bytes: number }>("SELECT host, bytes FROM host_usage WHERE day = ?", localDay(now)).map((r) => [r.host, r.bytes]));
}

/** Bytes per host per local day for the last `days` days (today included), oldest first. */
export function usageByDay(days = 7, now = clock.now()): { day: string; host: string; bytes: number }[] {
  return all<{ day: string; host: string; bytes: number }>(
    "SELECT day, host, bytes FROM host_usage WHERE day >= ? ORDER BY day, host",
    localDayBefore(now, days - 1),
  );
}

export type HostHealth = {
  host: string;
  limit: HostLimit | null;
  lastOkAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
};

/** Every host with a status row. */
export function hostHealth(now = clock.now()): HostHealth[] {
  return all<HostStatusRow>("SELECT * FROM host_status ORDER BY host").map((r) => ({
    host: r.host,
    limit: r.limited_until != null && r.limited_until > now ? toLimit(r) : null,
    lastOkAt: r.last_ok_at,
    lastErrorAt: r.last_error_at,
    lastError: r.last_error,
  }));
}

/** Notifies once per episode about hosts that have been limited for LONG_LIMIT_MS. Returns those hosts. */
export function notifyLongLimits(now = clock.now()): string[] {
  const rows = all<HostStatusRow>(
    "SELECT * FROM host_status WHERE limited_until > ? AND limited_since <= ? AND limit_notified_at IS NULL",
    now,
    now - LONG_LIMIT_MS,
  );
  for (const r of rows) {
    run("UPDATE host_status SET limit_notified_at = ? WHERE host = ?", now, r.host);
    const waiting =
      one<{ n: number }>("SELECT COUNT(*) AS n FROM links WHERE host = ? AND status IN ('new', 'queued')", r.host)?.n ?? 0;
    const hours = Math.floor((now - r.limited_since!) / HOUR);
    const message = `${hostLabel(r.host)} has been limited for ${hours}h (${r.limit_reason}); ${waiting} download(s) waiting, next try ${dateTime(r.limited_until!)}`;
    logEvent("warn", message, null, "host", { kind: "host_limited", data: { host: r.host, until: r.limited_until! } });
    void notify({ event: "needs_attention", message });
  }
  return rows.map((r) => r.host);
}
