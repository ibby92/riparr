// Server-only reads for History (reaches the database): user-facing activity, not the full log.
import { all, one } from "@/lib/db";
import { parseEpisode } from "@/lib/episodes";
import { startOfDay } from "@/lib/time";
import { ACTIVITY_KINDS, kindsIn, type ActivityCategory, type ActivityData, type ActivityKind } from "@/lib/activity";
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
  category?: ActivityCategory;
  period: HistoryPeriod;
  /** Only entries older than this id (the "Older" link's cursor). */
  before?: number;
};

export type HistoryEvent = {
  id: number;
  at: number;
  level: EventLevel;
  kind: ActivityKind;
  data: ActivityData;
  message: string;
  title_id: number | null;
  title_name: string | null;
  title_type: "show" | "movie" | null;
  title_year: number | null;
  has_poster: boolean;
};

/** Start of the period in ms, or null for all time. Days follow the configured time zone. */
export function periodStart(period: HistoryPeriod, now: number): number | null {
  if (period === "all") return null;
  return startOfDay(now, period === "today" ? 0 : period === "7d" ? 6 : 29);
}

type Row = Omit<HistoryEvent, "data" | "has_poster" | "kind"> & { kind: string; data: string | null; has_poster: number };

/**
 * Details for entries written before activity carried them (tagged by migration 12 from their
 * wording): read back from the message, with file sizes from the title's file records.
 */
export function legacyData(kind: string, message: string, titleId: number | null): ActivityData & { skipped?: boolean } {
  let skipped = false;
  const fileData = (name: string) => {
    const ep = parseEpisode(name);
    const row =
      titleId === null
        ? undefined
        : one<{ size: number | null; downloaded: number }>(
            `SELECT f.size, MAX(f.status = 'done') AS downloaded FROM files f JOIN links l ON l.id = f.link_id
              WHERE l.title_id = ? AND f.remote_name = ? GROUP BY f.remote_name`,
            titleId,
            name,
          );
    // Before "Already in the folder" existed, files found on disk were also logged as "Downloaded".
    if (row && !row.downloaded) skipped = true;
    return { name, season: ep?.season ?? null, episode: ep?.episode ?? null, size: row?.size ?? null };
  };
  let m: RegExpExecArray | null;
  if (kind === "downloaded" && (m = /^Downloaded (.+?) from (\S+?)(?: \(|$)/.exec(message))) {
    const file = /^\d+ files$/.test(m[1]) ? null : fileData(m[1]);
    return { host: m[2], files: file ? [file] : undefined, bytes: skipped ? undefined : (file?.size ?? undefined), skipped };
  }
  if (kind === "in_folder" && (m = /^Already in the folder, not downloaded: (.+)$/.exec(message)) && !/^\d+ files$/.test(m[1])) {
    return { files: [fileData(m[1])] };
  }
  if (kind === "links_found" && (m = /^Found (\d+) new link/.exec(message))) return { count: Number(m[1]) };
  if (kind === "links_added" && (m = /(\d+)(?: new)? of \d+ link/.exec(message))) return { count: Number(m[1]) };
  if (kind === "source_changed" && (m = /^Source page changed (?:from (\S+) )?to (\S+)$/.exec(message))) return { from: m[1], to: m[2] };
  if ((m = /^Source (?:added|removed|enabled|disabled): (\S+)$/.exec(message))) return { url: m[1] };
  if (kind === "title_deleted" && (m = /^Deleted (?:show|movie) "(.+)"/.exec(message))) return { name: m[1] };
  if (kind === "file_deleted" && (m = /^Deleted (.+?) from the folder(; it will be downloaded again)?/.exec(message))) {
    const ref = parseEpisode(m[1]);
    return { files: [{ name: m[1], season: ref?.season ?? null, episode: ref?.episode ?? null, size: null }], redownload: Boolean(m[2]) };
  }
  return {};
}

function parse(r: Row): HistoryEvent | null {
  if (!(r.kind in ACTIVITY_KINDS)) return null;
  let data: ActivityData | null = null;
  try {
    data = r.data ? (JSON.parse(r.data) as ActivityData) : null;
  } catch {
    // Unreadable details: fall back to the message.
  }
  if (data) return { ...r, kind: r.kind as ActivityKind, data, has_poster: r.has_poster === 1 };
  const { skipped, ...legacy } = legacyData(r.kind, r.message, r.title_id);
  return { ...r, kind: skipped ? "in_folder" : (r.kind as ActivityKind), data: legacy, has_poster: r.has_poster === 1 };
}

function conditions(filter: Omit<HistoryFilter, "before">, now: number) {
  const where = ["e.activity IS NOT NULL"];
  const params: (string | number)[] = [];
  if (filter.titleId !== undefined) {
    where.push("e.title_id = ?");
    params.push(filter.titleId);
  }
  if (filter.category) {
    const kinds = kindsIn(filter.category);
    where.push(`e.activity IN (${kinds.map(() => "?").join(", ")})`);
    params.push(...kinds);
  }
  const since = periodStart(filter.period, now);
  if (since !== null) {
    where.push("e.at >= ?");
    params.push(since);
  }
  return { where, params };
}

const SELECT = `
  SELECT e.id, e.at, e.level, e.activity AS kind, e.data, e.message, e.title_id,
         t.name AS title_name, t.type AS title_type, t.year AS title_year,
         (t.tmdb_id IS NOT NULL AND t.poster_path IS NOT NULL) AS has_poster
    FROM events e LEFT JOIN titles t ON t.id = e.title_id`;

/** Newest first, `limit` per page; `hasMore` when older matching entries exist. */
export function historyEvents(filter: HistoryFilter, now: number, limit = 100): { events: HistoryEvent[]; hasMore: boolean } {
  const { where, params } = conditions(filter, now);
  if (filter.before !== undefined) {
    where.push("e.id < ?");
    params.push(filter.before);
  }
  const rows = all<Row>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY e.id DESC LIMIT ?`, ...params, limit + 1);
  return { events: rows.slice(0, limit).flatMap((r) => parse(r) ?? []), hasMore: rows.length > limit };
}

export type HistorySummary = {
  /** Files downloaded (episodes, movie files). */
  downloads: number;
  bytes: number;
  /** Titles that got at least one download. */
  titles: number;
  linksFound: number;
  changes: number;
  problems: number;
};

/** Totals for the period (and title), whatever the category filter. */
export function historySummary(filter: Pick<HistoryFilter, "titleId" | "period">, now: number): HistorySummary {
  const { where, params } = conditions({ ...filter, category: undefined }, now);
  const rows = all<{ kind: string; data: string | null; title_id: number | null; message: string }>(
    `SELECT e.activity AS kind, e.data, e.title_id, e.message FROM events e WHERE ${where.join(" AND ")}`,
    ...params,
  );
  const s: HistorySummary = { downloads: 0, bytes: 0, titles: 0, linksFound: 0, changes: 0, problems: 0 };
  const titles = new Set<number>();
  for (const r of rows) {
    let kind = r.kind as ActivityKind;
    if (!ACTIVITY_KINDS[kind]) continue;
    let data: ActivityData = {};
    try {
      if (r.data) data = JSON.parse(r.data);
      else {
        const { skipped, ...legacy } = legacyData(kind, r.message, r.title_id);
        data = legacy;
        if (skipped) kind = "in_folder";
      }
    } catch {}
    const meta = ACTIVITY_KINDS[kind];
    if (kind === "downloaded") {
      s.downloads += data.files?.length || 1;
      s.bytes += data.bytes ?? 0;
      if (r.title_id !== null) titles.add(r.title_id);
    } else if (kind === "links_found") s.linksFound += data.count ?? 0;
    else if (meta.category === "library") s.changes++;
    else if (meta.category === "problems" && kind !== "host_limit_ended" && kind !== "disk_recovered") s.problems++;
  }
  s.titles = titles.size;
  return s;
}

/** Titles that have activity, for the title filter. */
export function historyTitles(): { id: number; name: string }[] {
  return all<{ id: number; name: string }>(
    `SELECT t.id, t.name FROM titles t
      WHERE EXISTS (SELECT 1 FROM events e WHERE e.title_id = t.id AND e.activity IS NOT NULL)
      ORDER BY t.name COLLATE NOCASE`,
  );
}
