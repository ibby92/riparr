import { all, run } from "./db";

export type EventLevel = "info" | "warn" | "error";

export type RiparrEvent = {
  id: number;
  at: number;
  level: EventLevel;
  container_id: number | null;
  container_name: string | null;
  message: string;
};

export function logEvent(level: EventLevel, message: string, containerId: number | null = null) {
  run(
    "INSERT INTO events (at, level, container_id, message) VALUES (?, ?, ?, ?)",
    Date.now(),
    level,
    containerId,
    message,
  );
}

export function recentEvents(limit = 50, containerId?: number): RiparrEvent[] {
  const where = containerId === undefined ? "" : "WHERE e.container_id = ?";
  const params = containerId === undefined ? [limit] : [containerId, limit];
  return all<RiparrEvent>(
    `SELECT e.*, c.name AS container_name
       FROM events e LEFT JOIN containers c ON c.id = e.container_id
       ${where}
      ORDER BY e.id DESC LIMIT ?`,
    ...params,
  );
}

export function pruneEvents(olderThanMs: number) {
  run("DELETE FROM events WHERE at < ?", Date.now() - olderThanMs);
}
