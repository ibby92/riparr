// Server-only read helpers for the dashboard (reaches the database).
import { all, one } from "@/lib/db";

const DAY = 24 * 60 * 60 * 1000;

export type WindowStats = {
  /** Distinct show episodes that finished in the window. */
  episodes: number;
  /** Movies with a file that finished in the window. */
  movies: number;
  /** Bytes of files downloaded in the window. */
  bytes: number;
};

function windowStats(from: number, to: number): WindowStats {
  const row = one<{ episodes: number; movies: number; bytes: number }>(
    `SELECT
       (SELECT COUNT(DISTINCT l.title_id || ':' || COALESCE(f.season, 1) || 'x' || f.episode)
          FROM files f JOIN links l ON l.id = f.link_id JOIN titles t ON t.id = l.title_id
         WHERE t.type = 'show' AND f.episode IS NOT NULL AND f.status IN ('done', 'skipped')
           AND f.updated_at >= ?1 AND f.updated_at < ?2) AS episodes,
       (SELECT COUNT(DISTINCT l.title_id)
          FROM files f JOIN links l ON l.id = f.link_id JOIN titles t ON t.id = l.title_id
         WHERE t.type = 'movie' AND f.status = 'done' AND f.updated_at >= ?1 AND f.updated_at < ?2) AS movies,
       (SELECT COALESCE(SUM(COALESCE(f.size, f.bytes_done)), 0)
          FROM files f WHERE f.status = 'done' AND f.updated_at >= ?1 AND f.updated_at < ?2) AS bytes`,
    from,
    to,
  );
  return row ?? { episodes: 0, movies: 0, bytes: 0 };
}

/** The last 7 days and the 7 before them (for the trend). */
export function weekStats(now: number): { current: WindowStats; previous: WindowStats } {
  return { current: windowStats(now - 7 * DAY, now + 1), previous: windowStats(now - 14 * DAY, now - 7 * DAY) };
}

export type DayRow = { key: string; label: string; total: number; byHost: Record<string, number> };

/** Local-time day key, e.g. "2026-10-10". */
function dayKey(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Bytes of finished files per day (server time) and host, oldest first, today last. */
export function downloadsByDay(now: number, days = 14): { days: DayRow[]; hosts: string[] } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const rows = all<{ at: number; host: string; bytes: number }>(
    `SELECT f.updated_at AS at, l.host, COALESCE(f.size, f.bytes_done) AS bytes
       FROM files f JOIN links l ON l.id = f.link_id
      WHERE f.status = 'done' AND f.updated_at >= ?`,
    start.getTime(),
  );
  const out: DayRow[] = [];
  const index = new Map<string, DayRow>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dayKey(d.getTime());
    const label = i === days - 1 ? "Today" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const row = { key, label, total: 0, byHost: {} };
    out.push(row);
    index.set(key, row);
  }
  const hosts = new Set<string>();
  for (const r of rows) {
    const row = index.get(dayKey(r.at));
    if (!row || !(r.bytes > 0)) continue;
    row.byHost[r.host] = (row.byHost[r.host] ?? 0) + r.bytes;
    row.total += r.bytes;
    hosts.add(r.host);
  }
  const order = ["gofile", "pixeldrain", "mega"];
  const sorted = [...hosts].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return { days: out, hosts: sorted };
}
