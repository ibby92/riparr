// Server-only read helpers: per-episode and per-title download state, derived from files + links.
// Imported only by server components (it reaches the database).
import { all } from "@/lib/db";
import { externalDiskFiles, type DiskFile } from "@/lib/disk-scan";
import { isVideo } from "@/lib/video";
import { parseEpisode } from "@/lib/episodes";
import { KNOWN_HOSTS } from "@/lib/host-ids";
import { activeHostLimits, hostLabel, type HostLimit } from "@/lib/host-status";
import { listSources, type SourceWithTitle } from "@/lib/sources";
import type { FileStatus, LinkStatus } from "@/lib/links";
import type { TitleWithStats } from "@/lib/titles";

/** One file of a title with its link's state. */
export type FileState = {
  file_id: number;
  link_id: number;
  title_id: number;
  season: number | null;
  episode: number | null;
  name: string;
  dir: string;
  size: number | null;
  bytes_done: number;
  speed_bps: number;
  status: FileStatus;
  local_path: string | null;
  /** Deleted from the folder through Riparr, not to be downloaded again. */
  removed_at: number | null;
  error: string | null;
  updated_at: number;
  host: string;
  link_status: LinkStatus;
  link_error: string | null;
  retry_at: number | null;
};

/**
 * What a viewer cares about, best first. "done" means in the folder (by the last scan);
 * "removed" was deleted through Riparr and isn't downloaded again; "missing" has no copy in
 * the folder or on its way.
 */
export type EpisodeState = "done" | "downloading" | "waiting" | "retrying" | "queued" | "standby" | "failed" | "removed" | "missing";

const RANK: Record<EpisodeState, number> = {
  done: 0,
  downloading: 1,
  waiting: 2,
  retrying: 3,
  queued: 4,
  standby: 5,
  failed: 6,
  removed: 7,
  missing: 8,
};

export type FileView = FileState & {
  state: EpisodeState;
  /** For waiting/retrying: when the next attempt happens. */
  until: number | null;
  /** Plain-language reason (host limit, last error), if any. */
  reason: string | null;
};

const FILE_SQL = `
  SELECT f.id AS file_id, f.link_id, l.title_id, f.season, f.episode, f.remote_name AS name, f.dir, f.size,
         f.bytes_done, f.speed_bps, f.status, f.local_path, f.removed_at, f.error, f.updated_at,
         l.host, l.status AS link_status, l.error AS link_error, l.retry_at
    FROM files f JOIN links l ON l.id = f.link_id`;

export function hostLimits(now: number): Map<string, HostLimit> {
  try {
    return new Map(activeHostLimits(now).map((l) => [l.host, l]));
  } catch {
    // Older schema without host_status: no limits known.
    return new Map();
  }
}

/**
 * Paths of the video files in each title's folder, by the last scan (disk_files). A title
 * whose folder was never scanned has no entry: its finished downloads are taken at their word.
 */
export type DiskIndex = Map<number, Set<string>>;

export function diskIndex(titleId?: number): DiskIndex {
  const rows = all<{ id: number; path: string | null }>(
    `SELECT t.id, d.path FROM titles t LEFT JOIN disk_files d ON d.title_id = t.id
      WHERE t.disk_scanned_at IS NOT NULL ${titleId === undefined ? "" : "AND t.id = ?"}`,
    ...(titleId === undefined ? [] : [titleId]),
  );
  const out: DiskIndex = new Map();
  for (const r of rows) {
    const set = out.get(r.id) ?? new Set<string>();
    if (r.path) set.add(r.path);
    out.set(r.id, set);
  }
  return out;
}

/** Every video file in a title's folder, by the last scan. */
export function diskFiles(titleId: number): DiskFile[] {
  return all<DiskFile>("SELECT * FROM disk_files WHERE title_id = ? ORDER BY season, episode, path", titleId);
}

export function fileView(f: FileState, limits: Map<string, HostLimit>, now: number, disk?: Set<string>): FileView {
  const base = { ...f, until: null, reason: null };
  switch (f.status) {
    case "done":
    case "skipped":
      if (f.removed_at !== null) return { ...base, state: "removed", reason: "Deleted from the folder; not downloaded again" };
      // The folder decides: a finished video that the last scan didn't find is gone. Archives
      // aren't scanned (they're usually deleted once extracted), so they stay done.
      if (disk && (!f.local_path || (isVideo(f.local_path) && !disk.has(f.local_path)))) {
        return { ...base, state: "missing", reason: "No longer in the folder" };
      }
      return { ...base, state: "done" };
    case "downloading":
      return { ...base, state: "downloading" };
    case "standby":
      return { ...base, state: "standby", reason: "Another host's copy is preferred" };
    case "failed":
      return { ...base, state: "failed", reason: f.error ?? f.link_error };
    case "queued": {
      const limit = limits.get(f.host);
      if (limit) return { ...base, state: "waiting", until: limit.until, reason: limit.reason };
      if (f.retry_at !== null && f.retry_at > now) return { ...base, state: "retrying", until: f.retry_at, reason: f.link_error };
      return { ...base, state: "queued" };
    }
  }
}

/** The file that best describes an episode: furthest along wins. */
export function bestFile(files: FileView[]): FileView {
  return files.reduce((a, b) => (RANK[b.state] < RANK[a.state] ? b : a));
}

export function titleFileViews(titleId: number, now: number, limits = hostLimits(now)): FileView[] {
  const disk = diskIndex(titleId).get(titleId);
  return all<FileState>(`${FILE_SQL} WHERE l.title_id = ? ORDER BY f.season, f.episode, f.dir, f.remote_name`, titleId).map((f) =>
    fileView(f, limits, now, disk),
  );
}

export type EpisodeRow = {
  key: string;
  season: number | null;
  episode: number;
  state: EpisodeState;
  /** The copy being shown (null for missing episodes and ones in the folder that Riparr didn't download). */
  file: FileView | null;
  /** Every copy of this episode across hosts. */
  copies: FileView[];
  /** A file in the title's folder that Riparr didn't download (counts as done). */
  disk: DiskFile | null;
  /** Hosts Riparr can't download from that the sources list this episode on. */
  unsupported: string[];
};

/** What else is known about a title's episodes besides its files. */
export type EpisodeExtras = {
  /** Video files in the folder that Riparr didn't download (see lib/disk-scan.ts). */
  disk: DiskFile[];
  /** Links on hosts Riparr can't download from, with the episode they're for. */
  unsupported: UnsupportedLink[];
};

export type UnsupportedLink = { season: number; episode: number; host: string };

const NO_EXTRAS: EpisodeExtras = { disk: [], unsupported: [] };
const SUPPORTED = new Set<string>(KNOWN_HOSTS.map((h) => h.id));
const episodeKey = (season: number | null, episode: number) => `${season ?? 1}x${episode}`;

function safeDecode(url: string) {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/** Links of a title on hosts Riparr can't download from, by episode (from the source's metadata or the label). */
export function unsupportedLinks(titleId: number): UnsupportedLink[] {
  const rows = all<{ host: string; episode: string | null; label: string | null; url: string }>(
    "SELECT host, episode, label, url FROM links WHERE title_id = ? AND status = 'ignored'",
    titleId,
  );
  return rows.flatMap((l) => {
    if (SUPPORTED.has(l.host)) return []; // ignored by the user, not unsupported
    const ref = parseEpisode(l.episode) ?? parseEpisode(l.label) ?? parseEpisode(safeDecode(l.url));
    return ref ? [{ ...ref, host: l.host }] : [];
  });
}

/** Folder files and unsupported-host links of one title, for its page. */
export function episodeExtras(titleId: number): EpisodeExtras {
  return { disk: externalDiskFiles(titleId), unsupported: unsupportedLinks(titleId) };
}

/**
 * Episodes of a show, by season. An episode is done when a file in the title's folder holds
 * it: Riparr's download (shown with its host) or a file it didn't download. When TMDB's
 * episode count is known and the title has one season, episodes no source lists yet show as
 * missing.
 */
export function episodeRows(title: Pick<TitleWithStats, "total_episodes">, files: FileView[], extras: EpisodeExtras = NO_EXTRAS): EpisodeRow[] {
  const groups = new Map<string, FileView[]>();
  for (const f of files) {
    if (f.episode == null) continue;
    const key = episodeKey(f.season, f.episode);
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }
  const disk = new Map<string, DiskFile>();
  for (const d of extras.disk) if (d.episode != null && !disk.has(episodeKey(d.season, d.episode))) disk.set(episodeKey(d.season, d.episode), d);
  const unsupported = new Map<string, Set<string>>();
  for (const u of extras.unsupported) {
    const key = episodeKey(u.season, u.episode);
    unsupported.set(key, (unsupported.get(key) ?? new Set()).add(u.host));
  }

  const keys = new Map<string, { season: number; episode: number }>();
  for (const [key, copies] of groups) keys.set(key, { season: copies[0].season ?? 1, episode: copies[0].episode! });
  for (const [key, d] of disk) keys.set(key, { season: d.season ?? 1, episode: d.episode! });
  for (const u of extras.unsupported) keys.set(episodeKey(u.season, u.episode), { season: u.season, episode: u.episode });

  const row = (key: string, season: number, episode: number): EpisodeRow => {
    const copies = groups.get(key) ?? [];
    const best = copies.length ? bestFile(copies) : null;
    const onDisk = disk.get(key) ?? null;
    const base = { key, season, episode, copies, unsupported: [...(unsupported.get(key) ?? [])].sort() };
    // Riparr's own download first; a copy skipped because of a folder file shows that file.
    const downloaded = copies.find((c) => c.state === "done" && c.status === "done");
    if (downloaded) return { ...base, state: "done", file: downloaded, disk: null };
    if (onDisk) return { ...base, state: "done", file: null, disk: onDisk };
    return { ...base, state: best?.state ?? "missing", file: best, disk: null };
  };
  const rows = [...keys.entries()].map(([key, k]) => row(key, k.season, k.episode));
  const seasons = new Set(rows.map((r) => r.season));
  if (title.total_episodes && seasons.size <= 1) {
    const season = rows[0]?.season ?? 1;
    for (let e = 1; e <= title.total_episodes; e++) {
      if (!keys.has(episodeKey(season, e))) rows.push(row(episodeKey(season, e), season, e));
    }
  }
  return rows.sort((a, b) => (a.season ?? 1) - (b.season ?? 1) || a.episode - b.episode);
}

export type TitleProgress = {
  /** Episodes (shows) or 1 (movies) the bar is out of. */
  total: number;
  done: number;
  downloading: number;
  waiting: number;
  /** Movie only: fraction of bytes done across the files being fetched. */
  movieFraction: number | null;
  movieState: EpisodeState | null;
  /** A host every waiting item is held by, if one. */
  waitingHost: { host: string; label: string; until: number } | null;
  latest: { season: number | null; episode: number | null; at: number } | null;
};

function emptyProgress(): TitleProgress {
  return { total: 0, done: 0, downloading: 0, waiting: 0, movieFraction: null, movieState: null, waitingHost: null, latest: null };
}

const ACTIVE = new Set<EpisodeState>(["downloading", "waiting", "retrying", "queued"]);

/** Rolls file states up to the title level, for cards and lists. */
export function summarize(title: TitleWithStats, files: FileView[], extras: EpisodeExtras = NO_EXTRAS): TitleProgress {
  const p = emptyProgress();
  for (const f of files) {
    if (f.state === "done" && (!p.latest || f.updated_at > p.latest.at)) p.latest = { season: f.season, episode: f.episode, at: f.updated_at };
  }
  const waitingFiles: FileView[] = [];
  if (title.type === "show") {
    const rows = episodeRows(title, files, extras);
    for (const r of rows) {
      if (r.state === "done") p.done++;
      else if (r.state === "downloading") p.downloading++;
      else if (r.state === "waiting" || r.state === "retrying" || r.state === "queued") {
        p.waiting++;
        if (r.file) waitingFiles.push(r.file);
      }
    }
    p.total = Math.max(title.total_episodes ?? 0, rows.length);
  } else {
    const relevant = files.filter((f) => f.state !== "standby");
    const state = files.length ? bestFile(files).state : "missing";
    const pending = relevant.filter((f) => ACTIVE.has(f.state));
    // A movie is done when something finished and nothing is still on its way.
    p.movieState = state === "done" && pending.length ? bestFile(pending).state : state;
    // The movie is already in its folder (from before Riparr, or added by hand).
    if (p.movieState !== "done" && p.movieState !== "downloading" && extras.disk.length) p.movieState = "done";
    const total = relevant.reduce((n, f) => n + (f.size ?? 0), 0);
    const doneBytes = relevant.reduce((n, f) => n + (f.state === "done" ? (f.size ?? f.bytes_done) : f.bytes_done), 0);
    p.movieFraction = p.movieState === "done" ? 1 : total > 0 ? Math.min(1, doneBytes / total) : null;
    p.total = 1;
    if (p.movieState === "done") p.done = 1;
    else if (p.movieState === "downloading") p.downloading = p.movieFraction ?? 0.5;
    else if (p.movieState === "waiting" || p.movieState === "retrying" || p.movieState === "queued") {
      p.waiting = 1;
      waitingFiles.push(...pending);
    }
  }
  const held = waitingFiles.filter((f) => f.state === "waiting");
  if (held.length && held.length === waitingFiles.length && held.every((f) => f.host === held[0].host)) {
    p.waitingHost = { host: held[0].host, label: hostLabel(held[0].host), until: held[0].until ?? 0 };
  }
  return p;
}

/** Progress for every title in one query. */
export function allTitleProgress(titles: TitleWithStats[], now: number): Map<number, TitleProgress> {
  const limits = hostLimits(now);
  const disk = diskIndex();
  const byTitle = new Map<number, FileView[]>();
  for (const f of all<FileState>(FILE_SQL)) {
    const v = fileView(f, limits, now, disk.get(f.title_id));
    const list = byTitle.get(f.title_id);
    if (list) list.push(v);
    else byTitle.set(f.title_id, [v]);
  }
  const external = new Map<number, DiskFile[]>();
  for (const d of externalDiskFiles()) external.set(d.title_id, [...(external.get(d.title_id) ?? []), d]);
  return new Map(titles.map((t) => [t.id, summarize(t, byTitle.get(t.id) ?? [], { disk: external.get(t.id) ?? [], unsupported: [] })]));
}

export function sourcesByTitle(): Map<number, SourceWithTitle[]> {
  const out = new Map<number, SourceWithTitle[]>();
  for (const s of listSources()) {
    const list = out.get(s.title_id);
    if (list) list.push(s);
    else out.set(s.title_id, [s]);
  }
  return out;
}

/** "mkvdrama.net" from a source URL. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
