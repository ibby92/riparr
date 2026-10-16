import path from "node:path";
import { z } from "zod";
import { all, one, run } from "./db";
import { isVideoSql } from "./video";
import { normalizeTargetDir, renderTemplate, resolveInside, sanitizeSegment } from "./paths";

export type TitleType = "show" | "movie";
export type SourceStatus = "pending" | "ok" | "needs_attention" | "error";
/** A title's overall state, rolled up from its sources (and `monitored`, `archived_at`). */
export type TitleStatus = SourceStatus | "paused" | "archived";

export type Title = {
  id: number;
  type: TitleType;
  name: string;
  year: number | null;
  tmdb_id: number | null;
  overview: string | null;
  poster_path: string | null;
  total_episodes: number | null;
  root_folder_id: number;
  folder: string;
  season_folders: number;
  naming: string;
  monitored: number;
  /** When lib/disk-scan.ts last looked at the title's folder. */
  disk_scanned_at: number | null;
  /** When the title was archived (kept, but no longer checked or downloaded); null if it isn't. */
  archived_at: number | null;
  /** A movie's release date (YYYY-MM-DD) from TMDB, for the calendar. */
  release_date: string | null;
  /** When lib/schedule.ts last read the title's episodes and air dates from TMDB. */
  schedule_synced_at: number | null;
  created_at: number;
  updated_at: number;
};

export type TitleWithStats = Title & {
  root_path: string;
  status: TitleStatus;
  /** Most recent source error/attention message, if any. */
  last_error: string | null;
  source_count: number;
  link_count: number;
  done_count: number;
  /** Distinct episodes with a downloaded file, or already in the folder. */
  episodes_done: number;
  /** Distinct episodes seen in any source. */
  episodes_seen: number;
  last_checked_at: number | null;
  last_changed_at: number | null;
};

const bool = z.preprocess((v) => v === true || v === "on" || v === "true" || v === 1 || v === "1", z.boolean());
const optionalInt = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce.number<string>().int().nullable(),
);

export const titleInput = z.object({
  type: z.enum(["show", "movie"]),
  name: z.string().trim().min(1, "Name is required").max(300),
  year: optionalInt.refine((v) => v === null || (v >= 1870 && v <= 2200), "Not a valid year"),
  tmdb_id: optionalInt,
  overview: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().nullable()),
  poster_path: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().nullable()),
  total_episodes: optionalInt,
  root_folder_id: z.coerce.number<string>().int().positive("Choose a root folder"),
  folder: z.string().transform((v, ctx) => {
    const dir = normalizeTargetDir(v);
    if (!dir) {
      ctx.addIssue({ code: "custom", message: "Use a folder name inside the root folder" });
      return z.NEVER;
    }
    return dir;
  }),
  season_folders: bool,
  naming: z
    .string()
    .trim()
    .default("{filename}")
    .refine((v) => v.includes("{filename}") || v.includes("{name}"), "Naming must include {filename} or {name}"),
  monitored: bool,
});

export type TitleInput = z.infer<typeof titleInput>;

/** Default folder for a title: "Doctor X", or "Movie Name (2024)" for movies. */
export function defaultFolder(name: string, type: TitleType, year: number | null): string {
  return sanitizeSegment(type === "movie" && year ? `${name} (${year})` : name);
}

const STATS = `
  SELECT t.*, r.path AS root_path,
         (SELECT COUNT(*) FROM sources s WHERE s.title_id = t.id) AS source_count,
         (SELECT COUNT(*) FROM links l WHERE l.title_id = t.id) AS link_count,
         (SELECT COUNT(*) FROM links l WHERE l.title_id = t.id AND l.status = 'done') AS done_count,
         (SELECT COUNT(*) FROM (
            SELECT COALESCE(d.season, 1) AS s, d.episode AS e FROM disk_files d WHERE d.title_id = t.id AND d.episode IS NOT NULL
            UNION
            -- Archives aren't scanned (they're usually deleted once extracted): a finished one still counts.
            SELECT COALESCE(f.season, 1), f.episode FROM files f JOIN links l ON l.id = f.link_id
             WHERE l.title_id = t.id AND f.episode IS NOT NULL AND f.status = 'done' AND NOT ${isVideoSql("f.local_path")}
          )) AS episodes_done,
         (SELECT COUNT(DISTINCT f.season || 'x' || f.episode) FROM files f JOIN links l ON l.id = f.link_id
           WHERE l.title_id = t.id AND f.episode IS NOT NULL) AS episodes_seen,
         (SELECT MAX(s.last_checked_at) FROM sources s WHERE s.title_id = t.id) AS last_checked_at,
         (SELECT MAX(s.last_changed_at) FROM sources s WHERE s.title_id = t.id) AS last_changed_at,
         (SELECT group_concat(s.status) FROM sources s WHERE s.title_id = t.id AND s.enabled = 1) AS source_statuses,
         (SELECT s.last_error FROM sources s WHERE s.title_id = t.id AND s.last_error IS NOT NULL
           ORDER BY s.last_checked_at DESC LIMIT 1) AS last_error
    FROM titles t JOIN root_folders r ON r.id = t.root_folder_id`;

type StatsRow = Omit<TitleWithStats, "status"> & { source_statuses: string | null };

/** Worst source state wins: needs attention > error > pending > ok. */
export function rollUpStatus(monitored: boolean, sourceStatuses: SourceStatus[], archived = false): TitleStatus {
  if (archived) return "archived";
  if (!monitored) return "paused";
  for (const s of ["needs_attention", "error", "pending"] as const) if (sourceStatuses.includes(s)) return s;
  return "ok";
}

function withStatus(row: StatsRow): TitleWithStats {
  const { source_statuses, ...rest } = row;
  const statuses = (source_statuses ? source_statuses.split(",") : []) as SourceStatus[];
  return { ...rest, status: rollUpStatus(rest.monitored === 1, statuses, rest.archived_at !== null) };
}

export function listTitles(type?: TitleType): TitleWithStats[] {
  const where = type ? "WHERE t.type = ?" : "";
  return all<StatsRow>(`${STATS} ${where} ORDER BY t.name COLLATE NOCASE`, ...(type ? [type] : [])).map(withStatus);
}

export function getTitle(id: number): TitleWithStats | undefined {
  const row = one<StatsRow>(`${STATS} WHERE t.id = ?`, id);
  return row && withStatus(row);
}

export function findTitleByTmdb(type: TitleType, tmdbId: number): Title | undefined {
  return one<Title>("SELECT * FROM titles WHERE type = ? AND tmdb_id = ?", type, tmdbId);
}

export function createTitle(input: TitleInput): number {
  const now = Date.now();
  const result = run(
    `INSERT INTO titles (type, name, year, tmdb_id, overview, poster_path, total_episodes, root_folder_id, folder,
                         season_folders, naming, monitored, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.type,
    input.name,
    input.year,
    input.tmdb_id,
    input.overview,
    input.poster_path,
    input.total_episodes,
    input.root_folder_id,
    input.folder,
    input.season_folders ? 1 : 0,
    input.naming,
    input.monitored ? 1 : 0,
    now,
    now,
  );
  return Number(result.lastInsertRowid);
}

export function updateTitle(id: number, input: TitleInput) {
  run(
    `UPDATE titles
        SET type = ?, name = ?, year = ?, tmdb_id = ?, overview = ?, poster_path = ?, total_episodes = ?,
            root_folder_id = ?, folder = ?, season_folders = ?, naming = ?, monitored = ?, updated_at = ?
      WHERE id = ?`,
    input.type,
    input.name,
    input.year,
    input.tmdb_id,
    input.overview,
    input.poster_path,
    input.total_episodes,
    input.root_folder_id,
    input.folder,
    input.season_folders ? 1 : 0,
    input.naming,
    input.monitored ? 1 : 0,
    Date.now(),
    id,
  );
}

/**
 * Archives a title (stops checks and downloads, keeps everything else) or brings it back,
 * monitored again. Archived titles stay unmonitored however they're edited.
 */
export function setTitleArchived(id: number, archived: boolean, now = Date.now()) {
  run(
    "UPDATE titles SET archived_at = ?, monitored = ?, updated_at = ? WHERE id = ?",
    archived ? now : null,
    archived ? 0 : 1,
    now,
    id,
  );
}

export function setTitleMonitored(id: number, monitored: boolean) {
  run("UPDATE titles SET monitored = ?, updated_at = ? WHERE id = ?", monitored ? 1 : 0, Date.now(), id);
}

/** Deletes the title, its sources and link history. Files on disk are kept. */
export function deleteTitle(id: number) {
  run("DELETE FROM titles WHERE id = ?", id);
}

export type FileVars = {
  filename: string;
  dir: string;
  host: string;
  date: Date;
  season?: number | null;
  episode?: number | null;
};

/**
 * Where a file of this title goes, as an absolute path:
 * <root>/<folder>/[Season NN/]<naming>. Shows with season folders on put files
 * whose season is known into "Season NN"; nothing can escape the root folder.
 */
export function fileDestination(
  title: Pick<Title, "type" | "name" | "year" | "folder" | "season_folders" | "naming">,
  rootPath: string,
  vars: FileVars,
): string {
  const seasonDir =
    title.type === "show" && title.season_folders && vars.season != null
      ? `Season ${String(vars.season).padStart(2, "0")}`
      : "";
  const name = renderTemplate(title.naming, { ...vars, title: title.name, year: title.year });
  return resolveInside(rootPath, path.posix.join(title.folder, seasonDir, name));
}
