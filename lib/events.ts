import type { ActivityData, ActivityKind } from "./activity";
import { all, run } from "./db";
import { getSetting, setSetting } from "./settings";

/**
 * Log levels, lowest first:
 * - debug: step-by-step detail for troubleshooting (what was fetched, decided, retried). Written only
 *   while debug logging is on (Settings in System → Logs, or RIPARR_LOG_LEVEL=debug); kept 3 days.
 * - info: something the user would want in the activity feed: a title added, links found, a file
 *   downloaded or extracted, the worker starting.
 * - warn: something went wrong or is degraded, and Riparr is handling it (retrying, waiting out a
 *   host limit, using a mirror) or a person may want to look (a source needs attention).
 * - error: something failed and won't fix itself: a download gave up, an archive can't be extracted,
 *   a source keeps failing, a component couldn't start.
 */
export type EventLevel = "debug" | "info" | "warn" | "error";

export const LEVEL_RANK: Record<EventLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** The part of Riparr an entry comes from, for filtering logs. */
export type LogComponent =
  | "check" // reading source pages
  | "mirror" // choosing which copy to download
  | "download"
  | "host" // host limits and health
  | "scan" // title folder scans
  | "extract"
  | "disk" // free space, partial files
  | "cnl" // Click'n'Load
  | "notify"
  | "tmdb"
  | "auth"
  | "web" // UI actions and the REST API
  | "worker";

export const LOG_COMPONENTS: Record<LogComponent, string> = {
  check: "Source checks",
  mirror: "Mirror selection",
  download: "Downloads",
  host: "Hosts",
  scan: "Folder scans",
  extract: "Extraction",
  disk: "Disk",
  cnl: "Click'n'Load",
  notify: "Notifications",
  tmdb: "TMDB",
  auth: "Login",
  web: "Web and API",
  worker: "Worker",
};

export type RiparrEvent = {
  id: number;
  at: number;
  level: EventLevel;
  title_id: number | null;
  title_name: string | null;
  component: LogComponent | null;
  message: string;
  activity: ActivityKind | null;
  /** JSON ActivityData, when the activity carries details. */
  data: string | null;
};

/** Marks an entry as user-facing activity for History (see lib/activity.ts). */
export type Activity = { kind: ActivityKind; data?: ActivityData };

const LEVEL_KEY = "log.level";
/** How long the cached debug switch is trusted; both processes pick up a change within this. */
const CACHE_MS = 5_000;
let cached: { debug: boolean; at: number } | null = null;

/** Whether debug entries are written: RIPARR_LOG_LEVEL=debug, or the setting on System → Logs. */
export function debugLogging(now = Date.now()): boolean {
  if (process.env.RIPARR_LOG_LEVEL?.toLowerCase() === "debug") return true;
  if (cached && now - cached.at < CACHE_MS) return cached.debug;
  let debug = false;
  try {
    debug = getSetting(LEVEL_KEY) === "debug";
  } catch {
    // No database yet (very early start-up): stay at info.
  }
  cached = { debug, at: now };
  return debug;
}

/** True when the environment forces debug logging, so the setting can't turn it off. */
export function debugForcedByEnv(): boolean {
  return process.env.RIPARR_LOG_LEVEL?.toLowerCase() === "debug";
}

export function setDebugLogging(on: boolean) {
  setSetting(LEVEL_KEY, on ? "debug" : "info");
  cached = null;
}

const CONSOLE: Record<EventLevel, "debug" | "log" | "warn" | "error"> = { debug: "log", info: "log", warn: "warn", error: "error" };

/**
 * Records a log entry (History and System → Logs) and mirrors it to the console for `docker logs`.
 * Debug entries are dropped unless debug logging is on. Never put secrets (passwords, tokens, API
 * keys, proxy credentials) in a message.
 */
export function logEvent(
  level: EventLevel,
  message: string,
  titleId: number | null = null,
  component: LogComponent | null = null,
  activity?: Activity,
) {
  if (level === "debug" && !debugLogging()) return;
  run(
    "INSERT INTO events (at, level, title_id, component, message, activity, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    Date.now(),
    level,
    titleId,
    component,
    message,
    activity?.kind ?? null,
    activity?.data ? JSON.stringify(activity.data) : null,
  );
  if (process.env.NODE_ENV !== "test") {
    const where = [component, titleId !== null ? `title ${titleId}` : null].filter(Boolean).join(" ");
    console[CONSOLE[level]](`[riparr] ${level.toUpperCase().padEnd(5)} ${where ? `[${where}] ` : ""}${message}`);
  }
}

/** A debug entry; the message is only built when debug logging is on. */
export function logDebug(component: LogComponent, message: string | (() => string), titleId: number | null = null) {
  if (!debugLogging()) return;
  logEvent("debug", typeof message === "function" ? message() : message, titleId, component);
}

const lastLogged = new Map<string, number>();

/**
 * Logs at most once per `intervalMs` for a key, for failures that could otherwise repeat every
 * worker tick. Returns whether it logged.
 */
export function logThrottled(
  key: string,
  intervalMs: number,
  level: EventLevel,
  message: string,
  titleId: number | null = null,
  component: LogComponent | null = null,
  now = Date.now(),
): boolean {
  const last = lastLogged.get(key);
  if (last !== undefined && now - last < intervalMs) return false;
  lastLogged.set(key, now);
  logEvent(level, message, titleId, component);
  return true;
}

/** Recent activity (what History shows), newest first, optionally for one title. */
export function recentEvents(limit = 50, titleId?: number): RiparrEvent[] {
  const where = titleId === undefined ? "WHERE e.activity IS NOT NULL" : "WHERE e.activity IS NOT NULL AND e.title_id = ?";
  const params = titleId === undefined ? [limit] : [titleId, limit];
  return all<RiparrEvent>(
    `SELECT e.*, t.name AS title_name
       FROM events e LEFT JOIN titles t ON t.id = e.title_id
       ${where}
      ORDER BY e.id DESC LIMIT ?`,
    ...params,
  );
}

/** Deletes old entries: debug ones sooner, since they're many and only for troubleshooting. */
export function pruneEvents(olderThanMs: number, debugOlderThanMs = 3 * 24 * 60 * 60 * 1000, now = Date.now()) {
  run("DELETE FROM events WHERE at < ?", now - olderThanMs);
  run("DELETE FROM events WHERE level = 'debug' AND at < ?", now - debugOlderThanMs);
}
