// Server-only reads for System → Logs (reaches the database).
import { all, one } from "@/lib/db";
import { LEVEL_RANK, type EventLevel, type LogComponent } from "@/lib/events";

export type LogFilter = {
  /** Lowest level shown: "info" shows info, warnings and errors. */
  minLevel: EventLevel;
  component?: LogComponent;
  titleId?: number;
  /** Case-insensitive text in the message. */
  text?: string;
  /** Only entries older than this id (the "Older" cursor). */
  before?: number;
};

export type LogEntry = {
  id: number;
  at: number;
  level: EventLevel;
  component: LogComponent | null;
  title_id: number | null;
  title_name: string | null;
  message: string;
};

const LEVELS_AT_OR_ABOVE = (min: EventLevel) => (Object.keys(LEVEL_RANK) as EventLevel[]).filter((l) => LEVEL_RANK[l] >= LEVEL_RANK[min]);

/** Newest first, `limit` per page; `hasMore` when older matching entries exist. */
export function logEntries(filter: LogFilter, limit = 200): { entries: LogEntry[]; hasMore: boolean } {
  const levels = LEVELS_AT_OR_ABOVE(filter.minLevel);
  const where = [`e.level IN (${levels.map(() => "?").join(", ")})`];
  const params: (string | number)[] = [...levels];
  if (filter.component) {
    where.push("e.component = ?");
    params.push(filter.component);
  }
  if (filter.titleId !== undefined) {
    where.push("e.title_id = ?");
    params.push(filter.titleId);
  }
  if (filter.text) {
    where.push("e.message LIKE ? ESCAPE '\\'");
    params.push(`%${filter.text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  if (filter.before !== undefined) {
    where.push("e.id < ?");
    params.push(filter.before);
  }
  const rows = all<LogEntry>(
    `SELECT e.id, e.at, e.level, e.component, e.title_id, e.message, t.name AS title_name
       FROM events e LEFT JOIN titles t ON t.id = e.title_id
      WHERE ${where.join(" AND ")}
      ORDER BY e.id DESC LIMIT ?`,
    ...params,
    limit + 1,
  );
  return { entries: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** Entry counts per level, and the oldest entry, for the page header. */
export function logStats(): { counts: Record<EventLevel, number>; oldest: number | null } {
  const counts: Record<EventLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
  for (const r of all<{ level: EventLevel; n: number }>("SELECT level, COUNT(*) AS n FROM events GROUP BY level")) counts[r.level] = r.n;
  return { counts, oldest: one<{ at: number | null }>("SELECT MIN(at) AS at FROM events")?.at ?? null };
}

/** Titles that appear in the log, for the title filter. */
export function logTitles(): { id: number; name: string }[] {
  return all<{ id: number; name: string }>(
    "SELECT t.id, t.name FROM titles t WHERE EXISTS (SELECT 1 FROM events e WHERE e.title_id = t.id) ORDER BY t.name COLLATE NOCASE",
  );
}
