// Server-only read helpers: per-episode and per-title download state, derived from files + links.
// Imported only by server components (it reaches the database).
import { all } from "@/lib/db";
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
  error: string | null;
  updated_at: number;
  host: string;
  link_status: LinkStatus;
  link_error: string | null;
  retry_at: number | null;
};

/** What a viewer cares about, best first. */
export type EpisodeState = "done" | "downloading" | "waiting" | "retrying" | "queued" | "standby" | "failed" | "missing";

const RANK: Record<EpisodeState, number> = {
  done: 0,
  downloading: 1,
  waiting: 2,
  retrying: 3,
  queued: 4,
  standby: 5,
  failed: 6,
  missing: 7,
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
         f.bytes_done, f.speed_bps, f.status, f.local_path, f.error, f.updated_at,
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

export function fileView(f: FileState, limits: Map<string, HostLimit>, now: number): FileView {
  const base = { ...f, until: null, reason: null };
  switch (f.status) {
    case "done":
    case "skipped":
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
  return all<FileState>(`${FILE_SQL} WHERE l.title_id = ? ORDER BY f.season, f.episode, f.dir, f.remote_name`, titleId).map((f) =>
    fileView(f, limits, now),
  );
}

export type EpisodeRow = {
  key: string;
  season: number | null;
  episode: number;
  state: EpisodeState;
  /** The copy being shown (null for missing episodes). */
  file: FileView | null;
  /** Every copy of this episode across hosts. */
  copies: FileView[];
};

/**
 * Episodes of a show, by season. When TMDB's episode count is known and the
 * title has one season, episodes no source lists yet show as missing.
 */
export function episodeRows(title: Pick<TitleWithStats, "total_episodes">, files: FileView[]): EpisodeRow[] {
  const groups = new Map<string, FileView[]>();
  for (const f of files) {
    if (f.episode == null) continue;
    const key = `${f.season ?? 1}x${f.episode}`;
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }
  const rows: EpisodeRow[] = [...groups.entries()].map(([key, copies]) => {
    const file = bestFile(copies);
    return { key, season: copies[0].season ?? 1, episode: copies[0].episode!, state: file.state, file, copies };
  });
  const seasons = new Set(rows.map((r) => r.season));
  if (title.total_episodes && seasons.size <= 1) {
    const season = rows[0]?.season ?? 1;
    for (let e = 1; e <= title.total_episodes; e++) {
      if (!groups.has(`${season}x${e}`)) rows.push({ key: `${season}x${e}`, season, episode: e, state: "missing", file: null, copies: [] });
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

/** Rolls file states up to the title level, for cards and lists. */
export function summarize(title: TitleWithStats, files: FileView[]): TitleProgress {
  const p = emptyProgress();
  for (const f of files) {
    if (f.state === "done" && (!p.latest || f.updated_at > p.latest.at)) p.latest = { season: f.season, episode: f.episode, at: f.updated_at };
  }
  const waitingFiles: FileView[] = [];
  if (title.type === "show") {
    const rows = episodeRows(title, files);
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
    const pending = relevant.filter((f) => f.state !== "done" && f.state !== "failed");
    // A movie is done when something finished and nothing is still on its way.
    p.movieState = state === "done" && pending.length ? bestFile(pending).state : state;
    const total = relevant.reduce((n, f) => n + (f.size ?? 0), 0);
    const doneBytes = relevant.reduce((n, f) => n + (f.state === "done" ? (f.size ?? f.bytes_done) : f.bytes_done), 0);
    p.movieFraction = total > 0 ? Math.min(1, doneBytes / total) : null;
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
  const byTitle = new Map<number, FileView[]>();
  for (const f of all<FileState>(FILE_SQL)) {
    const v = fileView(f, limits, now);
    const list = byTitle.get(f.title_id);
    if (list) list.push(v);
    else byTitle.set(f.title_id, [v]);
  }
  return new Map(titles.map((t) => [t.id, summarize(t, byTitle.get(t.id) ?? [])]));
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
