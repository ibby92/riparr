// Server-only read helpers for the dashboard (reaches the database).
import { all, one } from "@/lib/db";
import { formatter, localDay, localDayBefore, startOfDayKey } from "@/lib/time";

const DAY = 24 * 60 * 60 * 1000;

export type WindowStats = {
  /** Distinct show episodes downloaded in the window (not ones found already in the folder). */
  episodes: number;
  /** Movies with a file that finished in the window. */
  movies: number;
  /** Bytes transferred from hosts in the window (host_usage, the same figures as the sidebar). */
  bytes: number;
};

function windowStats(from: number, to: number, fromDay: string, toDay: string): WindowStats {
  const row = one<{ episodes: number; movies: number; bytes: number }>(
    `SELECT
       (SELECT COUNT(DISTINCT l.title_id || ':' || COALESCE(f.season, 1) || 'x' || f.episode)
          FROM files f JOIN links l ON l.id = f.link_id JOIN titles t ON t.id = l.title_id
         WHERE t.type = 'show' AND f.episode IS NOT NULL AND f.status = 'done'
           AND f.updated_at >= ?1 AND f.updated_at < ?2) AS episodes,
       (SELECT COUNT(DISTINCT l.title_id)
          FROM files f JOIN links l ON l.id = f.link_id JOIN titles t ON t.id = l.title_id
         WHERE t.type = 'movie' AND f.status = 'done' AND f.updated_at >= ?1 AND f.updated_at < ?2) AS movies,
       (SELECT COALESCE(SUM(bytes), 0) FROM host_usage WHERE day >= ?3 AND day <= ?4) AS bytes`,
    from,
    to,
    fromDay,
    toDay,
  );
  return row ?? { episodes: 0, movies: 0, bytes: 0 };
}

/**
 * The last 7 days and the 7 before them (for the trend). Episodes count from
 * finished files; data counts what was transferred, per local day (today included).
 */
export function weekStats(now: number): { current: WindowStats; previous: WindowStats } {
  return {
    current: windowStats(now - 7 * DAY, now + 1, localDayBefore(now, 6), localDay(now)),
    previous: windowStats(now - 14 * DAY, now - 7 * DAY, localDayBefore(now, 13), localDayBefore(now, 7)),
  };
}

/** A file that finished downloading, for the arrivals strip. */
export type Arrival = {
  file_id: number;
  title_id: number;
  title_name: string;
  title_type: "show" | "movie";
  year: number | null;
  has_poster: boolean;
  season: number | null;
  episode: number | null;
  name: string;
  size: number | null;
  host: string;
  at: number;
};

export type DayRow = {
  key: string;
  label: string;
  /** Bytes transferred that day (host_usage). */
  total: number;
  byHost: Record<string, number>;
  /** Files that finished that day, oldest first. */
  arrivals: Arrival[];
};

export function downloadsByDay(now: number, days = 14): { days: DayRow[]; hosts: string[] } {
  // Same source as the sidebar and the Queue: bytes actually transferred per host and local day.
  // It keeps counting downloads of titles deleted since, and includes retried or partial transfers.
  const rows = all<{ day: string; host: string; bytes: number }>(
    "SELECT day, host, bytes FROM host_usage WHERE day >= ?",
    localDayBefore(now, days - 1),
  );
  const out: DayRow[] = [];
  const index = new Map<string, DayRow>();
  for (let i = days - 1; i >= 0; i--) {
    const key = localDayBefore(now, i);
    const label = i === 0 ? "Today" : formatter({ day: "numeric", month: "short" }).format(startOfDayKey(key));
    const row: DayRow = { key, label, total: 0, byHost: {}, arrivals: [] };
    out.push(row);
    index.set(key, row);
  }
  const hosts = new Set<string>();
  for (const r of rows) {
    const row = index.get(r.day);
    if (!row || !(r.bytes > 0)) continue;
    row.byHost[r.host] = (row.byHost[r.host] ?? 0) + r.bytes;
    row.total += r.bytes;
    hosts.add(r.host);
  }
  const arrivals = all<Omit<Arrival, "has_poster"> & { has_poster: number }>(
    `SELECT f.id AS file_id, t.id AS title_id, t.name AS title_name, t.type AS title_type, t.year,
            (t.tmdb_id IS NOT NULL AND t.poster_path IS NOT NULL) AS has_poster,
            f.season, f.episode, f.remote_name AS name, f.size, l.host, f.updated_at AS at
       FROM files f JOIN links l ON l.id = f.link_id JOIN titles t ON t.id = l.title_id
      WHERE f.status = 'done' AND f.updated_at >= ?
      ORDER BY f.updated_at, t.name, f.season, f.episode`,
    startOfDayKey(out[0].key),
  );
  for (const a of arrivals) index.get(localDay(a.at))?.arrivals.push({ ...a, has_poster: a.has_poster === 1 });
  const order = ["gofile", "pixeldrain", "mega"];
  const sorted = [...hosts].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return { days: out, hosts: sorted };
}
