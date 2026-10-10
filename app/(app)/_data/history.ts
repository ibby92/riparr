// Server-only reads for the History page (reaches the database).
import { all } from "@/lib/db";
import type { EventLevel } from "@/lib/events";

export type HistoryPeriod = "today" | "7d" | "30d" | "all";
export const HISTORY_PERIODS: Record<HistoryPeriod, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

export type HistoryFilter = {
  titleId?: number;
  level?: EventLevel;
  period: HistoryPeriod;
  /** Only events older than this id (the "Older" link's cursor). */
  before?: number;
};

export type HistoryEvent = {
  id: number;
  at: number;
  level: EventLevel;
  title_id: number | null;
  title_name: string | null;
  title_type: "show" | "movie" | null;
  message: string;
};

/** Start of the period in ms, or null for all time. Days follow the server's time zone. */
function periodStart(period: HistoryPeriod, now: number): number | null {
  if (period === "all") return null;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const days = period === "today" ? 0 : period === "7d" ? 6 : 29;
  midnight.setDate(midnight.getDate() - days);
  return midnight.getTime();
}

/** Newest first, `limit` per page; `hasMore` when older matching events exist. */
export function historyEvents(filter: HistoryFilter, now: number, limit = 100): { events: HistoryEvent[]; hasMore: boolean } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.titleId !== undefined) {
    where.push("e.title_id = ?");
    params.push(filter.titleId);
  }
  if (filter.level) {
    where.push("e.level = ?");
    params.push(filter.level);
  }
  const since = periodStart(filter.period, now);
  if (since !== null) {
    where.push("e.at >= ?");
    params.push(since);
  }
  if (filter.before !== undefined) {
    where.push("e.id < ?");
    params.push(filter.before);
  }
  const rows = all<HistoryEvent>(
    `SELECT e.id, e.at, e.level, e.title_id, e.message, t.name AS title_name, t.type AS title_type
       FROM events e LEFT JOIN titles t ON t.id = e.title_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY e.id DESC LIMIT ?`,
    ...params,
    limit + 1,
  );
  return { events: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** Titles that have history, for the title filter. */
export function historyTitles(): { id: number; name: string }[] {
  return all<{ id: number; name: string }>(
    `SELECT t.id, t.name FROM titles t
      WHERE EXISTS (SELECT 1 FROM events e WHERE e.title_id = t.id)
      ORDER BY t.name COLLATE NOCASE`,
  );
}
