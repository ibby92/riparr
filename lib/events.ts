import { all, run } from "./db";

export type EventLevel = "info" | "warn" | "error";

export type RiparrEvent = {
  id: number;
  at: number;
  level: EventLevel;
  title_id: number | null;
  title_name: string | null;
  message: string;
};

export function logEvent(level: EventLevel, message: string, titleId: number | null = null) {
  run("INSERT INTO events (at, level, title_id, message) VALUES (?, ?, ?, ?)", Date.now(), level, titleId, message);
}

export function recentEvents(limit = 50, titleId?: number): RiparrEvent[] {
  const where = titleId === undefined ? "" : "WHERE e.title_id = ?";
  const params = titleId === undefined ? [limit] : [titleId, limit];
  return all<RiparrEvent>(
    `SELECT e.*, t.name AS title_name
       FROM events e LEFT JOIN titles t ON t.id = e.title_id
       ${where}
      ORDER BY e.id DESC LIMIT ?`,
    ...params,
  );
}

export function pruneEvents(olderThanMs: number) {
  run("DELETE FROM events WHERE at < ?", Date.now() - olderThanMs);
}
