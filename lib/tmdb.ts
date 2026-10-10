/**
 * Small typed client for TMDB API v3 (https://developer.themoviedb.org/reference).
 *
 * Accepts either credential TMDB issues on the account's API page:
 * - v3 "API Key" (32 hex chars), sent as `?api_key=`;
 * - v4 "API Read Access Token" (a long JWT, `eyJ…`), sent as `Authorization: Bearer`.
 * Both work against the v3 endpoints used here.
 *
 * Server-only: never import this from a client component (the API key must not reach the browser).
 */
import { NeedsAttentionError, RateLimitError } from "@/lib/errors";
import { parseRetryAfter } from "@/lib/hosts/http";

export const TMDB_API_BASE = "https://api.themoviedb.org/3";

/**
 * Image CDN base, as returned by `/configuration` (`images.secure_base_url`). TMDB documents it as
 * stable, so we use a constant instead of calling `/configuration` before every request.
 */
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/";

/** Poster widths TMDB serves (`images.poster_sizes`). */
export const POSTER_SIZES = ["w92", "w154", "w185", "w342", "w500", "w780", "original"] as const;
export type PosterSize = (typeof POSTER_SIZES)[number];

export const TMDB_TIMEOUT_MS = 15_000;
/** Wait when TMDB answers 429 without Retry-After. */
export const TMDB_DEFAULT_RETRY_MS = 10_000;
export const TMDB_CACHE_TTL_MS = 10 * 60_000;
export const TMDB_CACHE_MAX = 200;

export type MediaType = "show" | "movie";

/** The id or path doesn't exist on TMDB (HTTP 404, status_code 34). */
export class TmdbNotFoundError extends Error {
  name = "TmdbNotFoundError";
}

export type TmdbSearchResult = {
  tmdbId: number;
  type: MediaType;
  title: string;
  originalTitle: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  popularity: number;
  /** ISO 3166-1 codes; shows only. */
  originCountry?: string[];
};

export type TmdbSeason = {
  season: number;
  name: string;
  episodeCount: number;
  airDate?: string;
  /** Season 0 ("Specials"); excluded from totals. */
  special?: true;
};

export type TmdbShow = {
  tmdbId: number;
  type: "show";
  title: string;
  originalTitle: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  /** TMDB's status, e.g. "Returning Series", "Ended", "Canceled", "In Production". */
  status: string;
  originCountry: string[];
  seasons: TmdbSeason[];
  /** Regular seasons (specials excluded). */
  numberOfSeasons: number;
  /** Episodes across regular seasons (specials excluded). */
  totalEpisodes: number;
};

export type TmdbEpisode = {
  episode: number;
  title: string;
  airDate: string | null;
};

export type TmdbMovie = {
  tmdbId: number;
  type: "movie";
  title: string;
  originalTitle: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  /** Minutes; null when unknown. */
  runtime: number | null;
  releaseDate: string | null;
  status: string;
};

export type CallOptions = { signal?: AbortSignal };
export type SearchOptions = CallOptions & { type?: MediaType; year?: number; page?: number };
export type TestResult = { ok: true } | { ok: false; error: string };

export type TmdbClientOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  /** BCP-47-ish TMDB language, default "en-US". */
  language?: string;
};

export type TmdbClient = {
  search(query: string, opts?: SearchOptions): Promise<TmdbSearchResult[]>;
  show(tmdbId: number, opts?: CallOptions): Promise<TmdbShow>;
  season(tmdbId: number, seasonNumber: number, opts?: CallOptions): Promise<TmdbEpisode[]>;
  movie(tmdbId: number, opts?: CallOptions): Promise<TmdbMovie>;
  testConnection(opts?: CallOptions): Promise<TestResult>;
};

// ---------------------------------------------------------------------------------------------
// Auth

/**
 * v4 read access tokens are JWTs (`eyJ…` header, three dot-separated base64url parts, ~200+
 * chars). v3 keys are 32 hex chars. Anything JWT-shaped or longer than 64 chars is treated as v4.
 */
export function isV4Token(key: string): boolean {
  const k = key.trim();
  return /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(k) || k.length > 64;
}

// ---------------------------------------------------------------------------------------------
// Response cache (details calls only), shared by every client in the process so a client created
// per request still benefits. Keyed by credential + language + path.

type CacheEntry = { at: number; value: unknown };
const cache = new Map<string, CacheEntry>();

/** Clears the shared details cache (tests, or after the API key changes). */
export function clearTmdbCache() {
  cache.clear();
}

function cacheGet<T>(key: string, now: number): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (now - hit.at > TMDB_CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  // Refresh recency (Map keeps insertion order → cheap LRU).
  cache.delete(key);
  cache.set(key, hit);
  return hit.value as T;
}

function cacheSet(key: string, value: unknown, now: number) {
  cache.delete(key);
  cache.set(key, { at: now, value });
  while (cache.size > TMDB_CACHE_MAX) cache.delete(cache.keys().next().value!);
}

// ---------------------------------------------------------------------------------------------
// Raw TMDB shapes (only the fields we read)

type RawSearchItem = {
  id: number;
  media_type?: "tv" | "movie" | "person";
  name?: string;
  original_name?: string;
  title?: string;
  original_title?: string;
  first_air_date?: string;
  release_date?: string;
  overview?: string;
  poster_path?: string | null;
  popularity?: number;
  origin_country?: string[];
};
type RawPage = { page: number; results: RawSearchItem[]; total_pages: number; total_results: number };
type RawTv = {
  id: number;
  name: string;
  original_name?: string;
  first_air_date?: string | null;
  overview?: string;
  poster_path?: string | null;
  status?: string;
  origin_country?: string[];
  seasons?: { season_number: number; name?: string; episode_count?: number; air_date?: string | null }[];
};
type RawSeason = { episodes?: { episode_number: number; name?: string; air_date?: string | null }[] };
type RawMovie = {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string | null;
  overview?: string;
  poster_path?: string | null;
  runtime?: number | null;
  status?: string;
};

/** "2024-03-01" → 2024; "", null, junk → null. */
export function yearOf(date: string | null | undefined): number | null {
  const m = date?.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

const orNull = (s: string | null | undefined) => (s ? s : null);

function normalizeSearchItem(r: RawSearchItem, fallback?: "tv" | "movie"): TmdbSearchResult | null {
  const kind = r.media_type ?? fallback;
  if (kind === "tv") {
    return {
      tmdbId: r.id,
      type: "show",
      title: r.name ?? "",
      originalTitle: r.original_name ?? r.name ?? "",
      year: yearOf(r.first_air_date),
      overview: r.overview ?? "",
      posterPath: orNull(r.poster_path),
      popularity: r.popularity ?? 0,
      originCountry: r.origin_country ?? [],
    };
  }
  if (kind === "movie") {
    return {
      tmdbId: r.id,
      type: "movie",
      title: r.title ?? "",
      originalTitle: r.original_title ?? r.title ?? "",
      year: yearOf(r.release_date),
      overview: r.overview ?? "",
      posterPath: orNull(r.poster_path),
      popularity: r.popularity ?? 0,
    };
  }
  return null; // person, or something new
}

// ---------------------------------------------------------------------------------------------
// HTTP

async function tmdbError(res: Response): Promise<Error> {
  let message = "";
  try {
    const body = (await res.json()) as { status_message?: string };
    message = body?.status_message ?? "";
  } catch {
    if (!res.bodyUsed) await res.body?.cancel().catch(() => {});
  }
  if (res.status === 401) return new NeedsAttentionError("TMDB rejected the API key");
  if (res.status === 404) return new TmdbNotFoundError(message || "Not found on TMDB");
  if (res.status === 429) {
    const retry = parseRetryAfter(res.headers.get("retry-after"));
    return new RateLimitError("TMDB rate limit reached", retry ?? TMDB_DEFAULT_RETRY_MS);
  }
  return new Error(`TMDB error ${res.status}${message ? `: ${message}` : ""}`);
}

export function createTmdbClient(opts: TmdbClientOptions): TmdbClient {
  const apiKey = opts.apiKey.trim();
  const doFetch = opts.fetch ?? fetch;
  const language = opts.language ?? "en-US";
  const bearer = isV4Token(apiKey);

  async function get<T>(path: string, params: Record<string, string | number | undefined>, call?: CallOptions) {
    if (!apiKey) throw new NeedsAttentionError("TMDB API key is not set");
    const url = new URL(TMDB_API_BASE + path);
    for (const [k, v] of Object.entries({ language, ...params })) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (bearer) headers.authorization = `Bearer ${apiKey}`;
    else url.searchParams.set("api_key", apiKey);

    const timeout = AbortSignal.timeout(TMDB_TIMEOUT_MS);
    const signal = call?.signal ? AbortSignal.any([call.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await doFetch(url, { headers, signal, redirect: "follow" });
    } catch (err) {
      if (call?.signal?.aborted) throw call.signal.reason ?? err;
      if (timeout.aborted) throw new Error(`TMDB did not answer within ${TMDB_TIMEOUT_MS / 1000} s`);
      // Never echo the URL: with a v3 key it carries the key.
      const cause = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
      throw new Error(`Could not reach TMDB (${cause})`, { cause: err });
    }
    if (!res.ok) throw await tmdbError(res);
    return (await res.json()) as T;
  }

  async function cached<T>(path: string, call: CallOptions | undefined, map: (raw: never) => T): Promise<T> {
    const key = `${apiKey}|${language}|${path}`;
    const hit = cacheGet<T>(key, Date.now());
    if (hit !== undefined) return hit;
    const value = map((await get(path, {}, call)) as never);
    cacheSet(key, value, Date.now());
    return value;
  }

  function checkId(id: number, what = "TMDB id") {
    if (!Number.isSafeInteger(id) || id < 0) throw new Error(`Invalid ${what}: ${id}`);
  }

  return {
    async search(query, o = {}) {
      const q = query.trim();
      if (!q) return [];
      const page = o.page ?? 1;
      if (o.type === "show") {
        const raw = await get<RawPage>("/search/tv", { query: q, first_air_date_year: o.year, page, include_adult: "false" }, o);
        return raw.results.map((r) => normalizeSearchItem(r, "tv")).filter((r) => r !== null);
      }
      if (o.type === "movie") {
        const raw = await get<RawPage>("/search/movie", { query: q, primary_release_year: o.year, page, include_adult: "false" }, o);
        return raw.results.map((r) => normalizeSearchItem(r, "movie")).filter((r) => r !== null);
      }
      // search/multi has no year filter; filter client-side, allowing ±1 for late/early airings.
      const raw = await get<RawPage>("/search/multi", { query: q, page, include_adult: "false" }, o);
      const results = raw.results.map((r) => normalizeSearchItem(r)).filter((r) => r !== null);
      return o.year === undefined ? results : results.filter((r) => r.year === null || Math.abs(r.year - o.year!) <= 1);
    },

    async show(tmdbId, o) {
      checkId(tmdbId);
      return cached(`/tv/${tmdbId}`, o, (raw: RawTv): TmdbShow => {
        const seasons: TmdbSeason[] = (raw.seasons ?? [])
          .map((s) => ({
            season: s.season_number,
            name: s.name ?? (s.season_number === 0 ? "Specials" : `Season ${s.season_number}`),
            episodeCount: s.episode_count ?? 0,
            ...(s.air_date ? { airDate: s.air_date } : {}),
            ...(s.season_number === 0 ? { special: true as const } : {}),
          }))
          .sort((a, b) => a.season - b.season);
        const regular = seasons.filter((s) => !s.special);
        return {
          tmdbId: raw.id,
          type: "show",
          title: raw.name,
          originalTitle: raw.original_name ?? raw.name,
          year: yearOf(raw.first_air_date),
          overview: raw.overview ?? "",
          posterPath: orNull(raw.poster_path),
          status: raw.status ?? "",
          originCountry: raw.origin_country ?? [],
          seasons,
          numberOfSeasons: regular.length,
          totalEpisodes: regular.reduce((n, s) => n + s.episodeCount, 0),
        };
      });
    },

    async season(tmdbId, seasonNumber, o) {
      checkId(tmdbId);
      checkId(seasonNumber, "season number");
      return cached(`/tv/${tmdbId}/season/${seasonNumber}`, o, (raw: RawSeason): TmdbEpisode[] =>
        (raw.episodes ?? []).map((e) => ({
          episode: e.episode_number,
          title: e.name ?? "",
          airDate: orNull(e.air_date),
        })),
      );
    },

    async movie(tmdbId, o) {
      checkId(tmdbId);
      return cached(`/movie/${tmdbId}`, o, (raw: RawMovie): TmdbMovie => ({
        tmdbId: raw.id,
        type: "movie",
        title: raw.title,
        originalTitle: raw.original_title ?? raw.title,
        year: yearOf(raw.release_date),
        overview: raw.overview ?? "",
        posterPath: orNull(raw.poster_path),
        runtime: raw.runtime ? raw.runtime : null,
        releaseDate: orNull(raw.release_date),
        status: raw.status ?? "",
      }));
    },

    async testConnection(o) {
      try {
        // GET /authentication validates either credential type and returns {success: true}.
        const raw = await get<{ success?: boolean; status_message?: string }>("/authentication", {}, o);
        return raw.success === false ? { ok: false, error: raw.status_message || "TMDB refused the key" } : { ok: true };
      } catch (err) {
        if (err instanceof RateLimitError) return { ok: false, error: "TMDB is rate limiting requests; try again shortly" };
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/** Full image URL for a TMDB poster path ("/abc.jpg"), or null when there is none. */
export function posterUrl(posterPath: string | null | undefined, size: PosterSize = "w342"): string | null {
  if (!posterPath) return null;
  return `${TMDB_IMAGE_BASE}${size}${posterPath.startsWith("/") ? "" : "/"}${posterPath}`;
}

// ---------------------------------------------------------------------------------------------
// Release-name → search hints

export type ReleaseMatch = {
  /** Cleaned title to search TMDB for; "" if nothing usable was left. */
  query: string;
  season?: number;
  episode?: number;
  year?: number;
};

const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|mov|wmv|ts|m2ts|webm|flv|zip|rar|7z|r\d\d|\d{3}|part\d+|dlc|srt|ass)$/i;

/**
 * Tokens that mark the end of the title in a scene/P2P name, matched case-insensitively per word.
 * Deliberately excludes plain English words ("complete", "extended", "web", "max", "korean") that
 * also appear in real titles; those tags nearly always follow an SxxEyy/resolution marker anyway.
 */
const STOP_WORDS = new Set(
  (
    "480p 540p 576p 720p 1080p 1080i 2160p 4k uhd hdr hdr10 dv dovi sdr 10bit 8bit " +
    "webdl web-dl webrip hdtv hdrip bdrip brrip bluray blu-ray remux dvdrip " +
    "x264 x265 h264 h265 hevc avc av1 xvid aac ac3 eac3 ddp ddp5 dd5 dts flac " +
    "nf amzn dsnp hulu atvp hmax iqiyi viki wetv tving wavve repack " +
    "kor chn jpn eng esub esubs hardsub softsub"
  ).split(" "),
);

/**
 * Turns a release/container title into TMDB search hints, e.g.
 * "Doctor X Mafia in White S01 1080p NF" → { query: "Doctor X Mafia in White", season: 1 }
 * "Irreplaceable.S01E02.NF.x264.1080p[MkvDrama.net].mkv" → { query: "Irreplaceable", season: 1, episode: 2 }
 * "Some Movie (2023) 1080p" → { query: "Some Movie", year: 2023 }
 */
export function matchTitleFromRelease(name: string): ReleaseMatch {
  let s = name.trim().replace(VIDEO_EXT, "");
  // Site/group tags in brackets carry no title words: "[MkvDrama.net]", "{tag}".
  s = s.replace(/\[[^\]]*\]|\{[^}]*\}/g, " ");
  // Dots/underscores as separators (keep dots inside abbreviations like "H.264" harmless: stop word).
  s = s.replace(/[._]+/g, " ").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();

  const out: ReleaseMatch = { query: "" };
  const words = s.split(" ");
  let cut = words.length;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const lw = w.toLowerCase().replace(/[-+,]+$/, "");
    let m: RegExpMatchArray | null;
    if ((m = w.match(/^S(\d{1,2})(?:-?E(\d{1,4}))?(?:-?E\d{1,4})*$/i))) {
      out.season = Number(m[1]);
      if (m[2]) out.episode = Number(m[2]);
    } else if ((m = w.match(/^(\d{1,2})x(\d{2,3})$/i))) {
      out.season = Number(m[1]);
      out.episode = Number(m[2]);
    } else if (/^season$/i.test(w) && /^\d{1,2}$/.test(words[i + 1] ?? "")) {
      out.season = Number(words[i + 1]);
    } else if ((m = w.match(/^(?:E|EP)(\d{1,4})$/i))) {
      out.episode = Number(m[1]);
    } else if (/^(episode|ep)$/i.test(w) && /^\d{1,4}$/.test(words[i + 1] ?? "")) {
      out.episode = Number(words[i + 1]);
    } else if (i > 0 && (m = w.match(/^((?:19|20)\d{2})$/))) {
      // A leading number is part of the title ("1917", "2012"); later ones are the year.
      out.year = Number(m[1]);
    } else if (i > 0 && w === "-" && /^\d{1,4}$/.test(words[i + 1] ?? "")) {
      out.episode = Number(words[i + 1]); // anime style "Show - 05"
    } else if (!(i > 0 && STOP_WORDS.has(lw))) {
      continue;
    }
    cut = i;
    // Keep scanning for hints after the title ends (e.g. year after season), but don't re-cut.
    for (let j = i + 1; j < words.length; j++) {
      const v = words[j];
      const next = words[j + 1] ?? "";
      if (out.season === undefined && (m = v.match(/^S(\d{1,2})(?:-?E(\d{1,4}))?$/i))) {
        out.season = Number(m[1]);
        if (m[2] && out.episode === undefined) out.episode = Number(m[2]);
      } else if (out.season === undefined && /^season$/i.test(v) && /^\d{1,2}$/.test(next)) {
        out.season = Number(next);
      } else if (out.episode === undefined && (m = v.match(/^(?:E|EP)(\d{1,4})$/i))) {
        out.episode = Number(m[1]);
      } else if (out.episode === undefined && /^(episode|ep)$/i.test(v) && /^\d{1,4}$/.test(next)) {
        out.episode = Number(next);
      } else if (out.year === undefined && (m = v.match(/^((?:19|20)\d{2})$/))) {
        out.year = Number(m[1]);
      }
    }
    break;
  }

  out.query = words
    .slice(0, cut)
    .join(" ")
    .replace(/[\s\-–:|]+$/, "")
    .trim();
  return out;
}
