// Air dates for the calendar: each matched show's episodes (and a movie's release date) from TMDB,
// kept in the `episodes` table, and what Riparr has of each (downloaded, on its way, missing, upcoming).
import { all, getDb, one, run } from "./db";
import { logDebug, logThrottled } from "./events";
import { fetchFor } from "./net";
import { getSettings } from "./settings";
import { createTmdbClient, type TmdbClient } from "./tmdb";
import { localDay } from "./time";
import { isVideoSql } from "./video";

const HOUR = 60 * 60 * 1000;
/** How often a title's schedule is re-read from TMDB. */
export const SCHEDULE_MAX_AGE_MS = 12 * HOUR;

/** A TMDB client from the saved key, or null when TMDB isn't connected. */
export function tmdbClient(): TmdbClient | null {
  const { tmdbApiKey, tmdbLanguage } = getSettings();
  return tmdbApiKey ? createTmdbClient({ apiKey: tmdbApiKey, language: tmdbLanguage, fetch: fetchFor("host") }) : null;
}

/**
 * Reads a title's schedule from TMDB: every regular season's episodes with their air dates (specials
 * left out), or a movie's release date. Also keeps the show's episode count current.
 */
export async function syncSchedule(titleId: number, client: TmdbClient, now = Date.now()): Promise<{ episodes: number }> {
  const title = one<{ type: "show" | "movie"; tmdb_id: number | null; name: string }>("SELECT type, tmdb_id, name FROM titles WHERE id = ?", titleId);
  if (!title?.tmdb_id) return { episodes: 0 };

  if (title.type === "movie") {
    const movie = await client.movie(title.tmdb_id);
    run("UPDATE titles SET release_date = ?, schedule_synced_at = ? WHERE id = ?", movie.releaseDate, now, titleId);
    logDebug("tmdb", `Release date of ${title.name}: ${movie.releaseDate ?? "not announced"}`, titleId);
    return { episodes: 0 };
  }

  const show = await client.show(title.tmdb_id);
  const rows: { season: number; episode: number; name: string; airDate: string | null }[] = [];
  for (const s of show.seasons.filter((x) => !x.special)) {
    for (const e of await client.season(title.tmdb_id, s.season)) rows.push({ season: s.season, episode: e.episode, name: e.title, airDate: e.airDate });
  }
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    run("DELETE FROM episodes WHERE title_id = ?", titleId);
    const insert = db.prepare("INSERT INTO episodes (title_id, season, episode, name, air_date) VALUES (?, ?, ?, ?, ?)");
    // TMDB's placeholder names ("Episode 3") only repeat the number.
    for (const r of rows) insert.run(titleId, r.season, r.episode, r.name && !/^Episode \d+$/i.test(r.name.trim()) ? r.name : null, r.airDate);
    run(
      "UPDATE titles SET total_episodes = COALESCE(?, total_episodes), schedule_synced_at = ? WHERE id = ?",
      rows.length || null,
      now,
      titleId,
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  logDebug("tmdb", () => `Schedule of ${title.name}: ${rows.length} episode(s), next ${rows.find((r) => r.airDate && r.airDate >= localDay(now))?.airDate ?? "none announced"}`, titleId);
  return { episodes: rows.length };
}

/** Matched, unarchived titles whose schedule is older than `maxAgeMs`, never-synced first. */
export function staleSchedules(maxAgeMs: number, limit: number, now = Date.now()): number[] {
  return all<{ id: number }>(
    `SELECT id FROM titles
      WHERE tmdb_id IS NOT NULL AND archived_at IS NULL AND (schedule_synced_at IS NULL OR schedule_synced_at < ?)
      ORDER BY COALESCE(schedule_synced_at, 0), id LIMIT ?`,
    now - maxAgeMs,
    limit,
  ).map((r) => r.id);
}

let syncing = false;

/** Worker: refreshes a couple of stale schedules in the background (one run at a time). */
export function syncStaleSchedules(now = Date.now()) {
  if (syncing) return;
  const ids = staleSchedules(SCHEDULE_MAX_AGE_MS, 2, now);
  if (!ids.length) return;
  const client = tmdbClient();
  if (!client) return;
  syncing = true;
  void (async () => {
    for (const id of ids) {
      try {
        await syncSchedule(id, client, now);
      } catch (err) {
        // Mark it tried, so one bad title doesn't hold up the rest; it's retried after the usual wait.
        run("UPDATE titles SET schedule_synced_at = ? WHERE id = ?", now, id);
        logThrottled(`schedule:${id}`, 6 * HOUR, "warn", `Couldn't read the schedule from TMDB: ${err instanceof Error ? err.message : String(err)}`, id, "tmdb");
      }
    }
  })().finally(() => {
    syncing = false;
  });
}

/** What Riparr has of a scheduled episode or movie. */
export type ScheduleState = "downloaded" | "downloading" | "queued" | "missing" | "today" | "upcoming";

export type ScheduleItem = {
  title_id: number;
  title_name: string;
  title_type: "show" | "movie";
  year: number | null;
  has_poster: boolean;
  /** Paused titles are shown, but muted. */
  monitored: boolean;
  season: number | null;
  episode: number | null;
  /** Episode name, when TMDB has one. */
  name: string | null;
  /** YYYY-MM-DD */
  date: string;
  state: ScheduleState;
};

type Row = Omit<ScheduleItem, "has_poster" | "monitored" | "state"> & {
  has_poster: number;
  monitored: number;
  on_disk: number;
  downloading: number;
  queued: number;
};

/** Episode file states, by title/season/episode (a file without a season counts as season 1). */
const FILE_STATE = (status: string) => `EXISTS (
  SELECT 1 FROM files f JOIN links l ON l.id = f.link_id
   WHERE l.title_id = e.title_id AND COALESCE(f.season, 1) = e.season AND f.episode = e.episode AND ${status})`;

/**
 * Episodes and movie releases dated from `from` to `to` (YYYY-MM-DD, inclusive) for titles that
 * aren't archived, each with what Riparr has of it. `today` (YYYY-MM-DD) splits missing from upcoming.
 */
export function scheduleBetween(from: string, to: string, today: string): ScheduleItem[] {
  const episodes = all<Row>(
    `SELECT e.title_id, t.name AS title_name, t.type AS title_type, t.year, t.monitored,
            (t.tmdb_id IS NOT NULL AND t.poster_path IS NOT NULL) AS has_poster,
            e.season, e.episode, e.name, e.air_date AS date,
            (EXISTS (SELECT 1 FROM disk_files d WHERE d.title_id = e.title_id AND COALESCE(d.season, 1) = e.season AND d.episode = e.episode)
              OR ${FILE_STATE(`f.status = 'done' AND NOT ${isVideoSql("f.local_path")}`)}) AS on_disk,
            ${FILE_STATE("f.status = 'downloading'")} AS downloading,
            ${FILE_STATE("f.status IN ('queued', 'standby') AND l.status IN ('new', 'queued', 'resolving', 'downloading')")} AS queued
       FROM episodes e JOIN titles t ON t.id = e.title_id
      WHERE t.archived_at IS NULL AND e.air_date BETWEEN ? AND ?
      ORDER BY e.air_date, t.name COLLATE NOCASE, e.season, e.episode`,
    from,
    to,
  );
  const movies = all<Row>(
    `SELECT t.id AS title_id, t.name AS title_name, t.type AS title_type, t.year, t.monitored,
            (t.tmdb_id IS NOT NULL AND t.poster_path IS NOT NULL) AS has_poster,
            NULL AS season, NULL AS episode, NULL AS name, t.release_date AS date,
            EXISTS (SELECT 1 FROM disk_files d WHERE d.title_id = t.id) AS on_disk,
            EXISTS (SELECT 1 FROM files f JOIN links l ON l.id = f.link_id WHERE l.title_id = t.id AND f.status = 'downloading') AS downloading,
            EXISTS (SELECT 1 FROM links l WHERE l.title_id = t.id AND l.status IN ('new', 'queued', 'resolving')) AS queued
       FROM titles t
      WHERE t.type = 'movie' AND t.archived_at IS NULL AND t.release_date BETWEEN ? AND ?`,
    from,
    to,
  );
  return [...episodes, ...movies]
    .map(({ on_disk, downloading, queued, has_poster, monitored, ...r }) => ({
      ...r,
      has_poster: has_poster === 1,
      monitored: monitored === 1,
      state: (on_disk
        ? "downloaded"
        : downloading
          ? "downloading"
          : queued
            ? "queued"
            : r.date < today
              ? "missing"
              : r.date === today
                ? "today"
                : "upcoming") as ScheduleState,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title_name.localeCompare(b.title_name) || (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
}

/** Matched shows and movies, and how many have a schedule yet (for the calendar's notes). */
export function scheduleCoverage(): { matched: number; unmatched: number; synced: number } {
  const r = one<{ matched: number; unmatched: number; synced: number }>(
    `SELECT SUM(tmdb_id IS NOT NULL) AS matched, SUM(tmdb_id IS NULL) AS unmatched,
            SUM(tmdb_id IS NOT NULL AND schedule_synced_at IS NOT NULL) AS synced
       FROM titles WHERE archived_at IS NULL`,
  );
  return { matched: r?.matched ?? 0, unmatched: r?.unmatched ?? 0, synced: r?.synced ?? 0 };
}
