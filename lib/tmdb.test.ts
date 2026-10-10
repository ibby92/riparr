import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NeedsAttentionError, RateLimitError } from "./errors";
import movieDetails from "./__fixtures__/tmdb/movie-details.json";
import searchMulti from "./__fixtures__/tmdb/search-multi.json";
import tvDetails from "./__fixtures__/tmdb/tv-details.json";
import tvSeason from "./__fixtures__/tmdb/tv-season.json";
import {
  TMDB_CACHE_TTL_MS,
  TMDB_DEFAULT_RETRY_MS,
  TmdbNotFoundError,
  clearTmdbCache,
  createTmdbClient,
  isV4Token,
  matchTitleFromRelease,
  posterUrl,
  yearOf,
} from "./tmdb";

const V3_KEY = "0123456789abcdef0123456789abcdef";
const V4_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZiIsIm5iZiI6MTcwMDAwMDAwMCwic3ViIjoiNjU0MzIxIiwic2NvcGVzIjpbImFwaV9yZWFkIl0sInZlcnNpb24iOjF9.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU";

type Call = { url: URL; headers: Headers };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json;charset=utf-8", ...headers },
  });
}

/** Fake fetch routing by pathname; records every call. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    const route = routes[url.pathname.replace(/^\/3/, "")];
    if (!route) return json({ success: false, status_code: 34, status_message: "The resource you requested could not be found." }, 404);
    return route();
  }) as typeof fetch;
  return { fn, calls };
}

/** search/tv and search/movie items have no media_type. */
const stripMediaType = (r: object) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "media_type"));

beforeEach(() => clearTmdbCache());

describe("auth", () => {
  it("detects v4 tokens by shape", () => {
    expect(isV4Token(V3_KEY)).toBe(false);
    expect(isV4Token(V4_TOKEN)).toBe(true);
    expect(isV4Token(`  ${V4_TOKEN}\n`)).toBe(true);
  });

  it("sends a v3 key as ?api_key and no Authorization header", async () => {
    const f = fakeFetch({ "/authentication": () => json({ success: true, status_code: 1, status_message: "Success." }) });
    const res = await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).testConnection();
    expect(res).toEqual({ ok: true });
    expect(f.calls[0].url.searchParams.get("api_key")).toBe(V3_KEY);
    expect(f.calls[0].headers.get("authorization")).toBeNull();
  });

  it("sends a v4 token as Bearer and keeps it out of the URL", async () => {
    const f = fakeFetch({ "/authentication": () => json({ success: true }) });
    await createTmdbClient({ apiKey: V4_TOKEN, fetch: f.fn }).testConnection();
    expect(f.calls[0].headers.get("authorization")).toBe(`Bearer ${V4_TOKEN}`);
    expect(f.calls[0].url.searchParams.has("api_key")).toBe(false);
    expect(f.calls[0].url.toString()).not.toContain(V4_TOKEN);
  });

  it("passes the language", async () => {
    const f = fakeFetch({ "/search/multi": () => json(searchMulti) });
    await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn, language: "ko-KR" }).search("x");
    expect(f.calls[0].url.searchParams.get("language")).toBe("ko-KR");
  });
});

describe("search", () => {
  it("normalizes multi results, drops people, maps tv → show", async () => {
    const f = fakeFetch({ "/search/multi": () => json(searchMulti) });
    const results = await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).search("  Doctor X ");
    expect(f.calls[0].url.pathname).toBe("/3/search/multi");
    expect(f.calls[0].url.searchParams.get("query")).toBe("Doctor X");
    expect(f.calls[0].url.searchParams.get("include_adult")).toBe("false");
    expect(results.map((r) => [r.type, r.tmdbId])).toEqual([
      ["show", 61374],
      ["movie", 1043905],
      ["show", 99],
    ]);
    expect(results[0]).toEqual({
      tmdbId: 61374,
      type: "show",
      title: "Doctor X: Surgeon Michiko Daimon",
      originalTitle: "ドクターX～外科医・大門未知子～",
      year: 2012,
      overview: "A freelance surgeon who never fails.",
      posterPath: "/poster61374.jpg",
      popularity: 21.5,
      originCountry: ["JP"],
    });
    expect(results[1]).toMatchObject({ title: "Doctor X: The Movie", year: 2024, posterPath: null });
    expect(results[1]).not.toHaveProperty("originCountry");
    expect(results[2].year).toBeNull(); // empty first_air_date
  });

  it("uses search/tv with first_air_date_year for shows", async () => {
    const f = fakeFetch({
      "/search/tv": () => json({ page: 1, results: [searchMulti.results[0]].map(stripMediaType), total_pages: 1, total_results: 1 }),
    });
    const results = await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).search("Doctor X", { type: "show", year: 2012 });
    expect(f.calls[0].url.searchParams.get("first_air_date_year")).toBe("2012");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("show");
  });

  it("uses search/movie with primary_release_year for movies", async () => {
    const f = fakeFetch({
      "/search/movie": () => json({ page: 1, results: [searchMulti.results[2]].map(stripMediaType), total_pages: 1, total_results: 1 }),
    });
    const results = await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).search("Doctor X", { type: "movie", year: 2024 });
    expect(f.calls[0].url.searchParams.get("primary_release_year")).toBe("2024");
    expect(results[0]).toMatchObject({ type: "movie", tmdbId: 1043905 });
  });

  it("filters multi results by year ±1, keeping undated ones", async () => {
    const f = fakeFetch({ "/search/multi": () => json(searchMulti) });
    const results = await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).search("Doctor X", { year: 2025 });
    expect(results.map((r) => r.tmdbId)).toEqual([1043905, 99]);
  });

  it("returns [] for a blank query without calling TMDB", async () => {
    const f = fakeFetch({});
    expect(await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).search("   ")).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });

  it("does not cache searches", async () => {
    const f = fakeFetch({ "/search/multi": () => json(searchMulti) });
    const c = createTmdbClient({ apiKey: V3_KEY, fetch: f.fn });
    await c.search("a");
    await c.search("a");
    expect(f.calls).toHaveLength(2);
  });
});

describe("details", () => {
  it("normalizes a show, flags specials and excludes them from totals", async () => {
    const f = fakeFetch({ "/tv/240411": () => json(tvDetails) });
    const show = await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).show(240411);
    expect(show).toMatchObject({
      tmdbId: 240411,
      type: "show",
      title: "Doctor X: Age of the White Mafia",
      year: 2025,
      posterPath: "/dxposter.jpg",
      status: "Ended",
      originCountry: ["KR"],
      numberOfSeasons: 2,
      totalEpisodes: 28,
    });
    expect(show.seasons).toEqual([
      { season: 0, name: "Specials", episodeCount: 2, special: true },
      { season: 1, name: "Season 1", episodeCount: 16, airDate: "2025-04-05" },
      { season: 2, name: "Season 2", episodeCount: 12, airDate: "2026-11-01" },
    ]);
  });

  it("lists a season's episodes", async () => {
    const f = fakeFetch({ "/tv/240411/season/1": () => json(tvSeason) });
    const eps = await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).season(240411, 1);
    expect(eps).toEqual([
      { episode: 1, title: "Episode 1", airDate: "2025-04-05" },
      { episode: 2, title: "The White Mafia", airDate: "2025-04-06" },
      { episode: 3, title: "", airDate: null },
    ]);
  });

  it("normalizes a movie", async () => {
    const f = fakeFetch({ "/movie/1043905": () => json(movieDetails) });
    const movie = await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).movie(1043905);
    expect(movie).toEqual({
      tmdbId: 1043905,
      type: "movie",
      title: "Doctor X: The Movie",
      originalTitle: "劇場版ドクターX",
      year: 2024,
      overview: "The final operation.",
      posterPath: "/movieposter.jpg",
      runtime: 116,
      releaseDate: "2024-12-06",
      status: "Released",
    });
  });

  it("rejects bad ids before calling TMDB", async () => {
    const f = fakeFetch({});
    const c = createTmdbClient({ apiKey: V3_KEY, fetch: f.fn });
    await expect(c.show(1.5)).rejects.toThrow(/Invalid TMDB id/);
    await expect(c.season(1, -1)).rejects.toThrow(/Invalid season/);
    expect(f.calls).toHaveLength(0);
  });
});

describe("cache", () => {
  const realNow = Date.now;
  afterEach(() => {
    Date.now = realNow;
  });

  it("serves repeat details calls from cache, across clients, until the TTL passes", async () => {
    let now = 1_000_000;
    Date.now = () => now;
    const f = fakeFetch({ "/tv/240411": () => json(tvDetails) });
    await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).show(240411);
    await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).show(240411);
    expect(f.calls).toHaveLength(1);
    now += TMDB_CACHE_TTL_MS + 1;
    await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).show(240411);
    expect(f.calls).toHaveLength(2);
  });

  it("keys the cache by credential and language", async () => {
    const f = fakeFetch({ "/movie/1043905": () => json(movieDetails) });
    await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).movie(1043905);
    await createTmdbClient({ apiKey: V4_TOKEN, fetch: f.fn }).movie(1043905);
    await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn, language: "ja-JP" }).movie(1043905);
    expect(f.calls).toHaveLength(3);
  });

  it("does not cache errors", async () => {
    let fail = true;
    const f = fakeFetch({ "/movie/1": () => (fail ? json({ status_message: "boom" }, 500) : json(movieDetails)) });
    const c = createTmdbClient({ apiKey: V3_KEY, fetch: f.fn });
    await expect(c.movie(1)).rejects.toThrow("TMDB error 500: boom");
    fail = false;
    await expect(c.movie(1)).resolves.toMatchObject({ title: "Doctor X: The Movie" });
  });
});

describe("errors", () => {
  it("maps 401 to NeedsAttentionError", async () => {
    const f = fakeFetch({
      "/tv/1": () => json({ status_code: 7, status_message: "Invalid API key: You must be granted a valid key.", success: false }, 401),
    });
    const err = await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).show(1).catch((e) => e);
    expect(err).toBeInstanceOf(NeedsAttentionError);
    expect(err.message).toBe("TMDB rejected the API key");
  });

  it("maps 404 to TmdbNotFoundError", async () => {
    const f = fakeFetch({});
    const err = await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).movie(424242).catch((e) => e);
    expect(err).toBeInstanceOf(TmdbNotFoundError);
    expect(err.message).toMatch(/could not be found/);
  });

  it("maps 429 to RateLimitError honouring Retry-After", async () => {
    const f = fakeFetch({ "/tv/1": () => json({ status_code: 25, status_message: "Too many requests" }, 429, { "retry-after": "7" }) });
    const err = await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).show(1).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBe(7000);
  });

  it("uses a default wait for 429 without Retry-After", async () => {
    const f = fakeFetch({ "/tv/1": () => new Response("", { status: 429 }) });
    const err = await createTmdbClient({ apiKey: V3_KEY, fetch: f.fn }).show(1).catch((e) => e);
    expect(err.retryAfterMs).toBe(TMDB_DEFAULT_RETRY_MS);
  });

  it("wraps network errors without leaking the key", async () => {
    const fn = (async () => {
      throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND api.themoviedb.org") });
    }) as typeof fetch;
    const err = await createTmdbClient({ apiKey: V3_KEY, fetch: fn }).show(1).catch((e) => e);
    expect(err.message).toBe("Could not reach TMDB (getaddrinfo ENOTFOUND api.themoviedb.org)");
    expect(err.message).not.toContain(V3_KEY);
  });

  it("propagates a caller abort", async () => {
    const ac = new AbortController();
    const fn = ((_: unknown, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as typeof fetch;
    const p = createTmdbClient({ apiKey: V3_KEY, fetch: fn }).show(1, { signal: ac.signal });
    ac.abort(new Error("user cancelled"));
    await expect(p).rejects.toThrow("user cancelled");
  });

  it("refuses to call without a key", async () => {
    const f = fakeFetch({});
    await expect(createTmdbClient({ apiKey: " ", fetch: f.fn }).show(1)).rejects.toBeInstanceOf(NeedsAttentionError);
    expect(f.calls).toHaveLength(0);
  });
});

describe("testConnection", () => {
  it("never throws", async () => {
    const bad = fakeFetch({ "/authentication": () => json({ success: false, status_code: 7 }, 401) });
    expect(await createTmdbClient({ apiKey: V3_KEY, fetch: bad.fn }).testConnection()).toEqual({
      ok: false,
      error: "TMDB rejected the API key",
    });
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const res = await createTmdbClient({ apiKey: V3_KEY, fetch: down }).testConnection();
    expect(res.ok).toBe(false);
    const limited = fakeFetch({ "/authentication": () => new Response("", { status: 429 }) });
    expect((await createTmdbClient({ apiKey: V3_KEY, fetch: limited.fn }).testConnection()).ok).toBe(false);
    expect((await createTmdbClient({ apiKey: "", fetch: limited.fn }).testConnection()).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("builds poster URLs", () => {
    expect(posterUrl("/abc.jpg")).toBe("https://image.tmdb.org/t/p/w342/abc.jpg");
    expect(posterUrl("/abc.jpg", "original")).toBe("https://image.tmdb.org/t/p/original/abc.jpg");
    expect(posterUrl(null)).toBeNull();
    expect(posterUrl("")).toBeNull();
  });

  it("parses years", () => {
    expect(yearOf("2024-01-05")).toBe(2024);
    expect(yearOf("")).toBeNull();
    expect(yearOf(null)).toBeNull();
  });
});

describe("matchTitleFromRelease", () => {
  it.each([
    ["Doctor X Mafia in White S01 1080p NF", { query: "Doctor X Mafia in White", season: 1 }],
    ["Irreplaceable.S01E02.NF.x264.1080p[MkvDrama.net].mkv", { query: "Irreplaceable", season: 1, episode: 2 }],
    ["Some.Movie.2023.1080p.WEB-DL.DDP5.1.H.264-GRP.mkv", { query: "Some Movie", year: 2023 }],
    ["Some Movie (2023) 2160p", { query: "Some Movie", year: 2023 }],
    ["1917.2019.1080p.BluRay.x264", { query: "1917", year: 2019 }],
    ["The.Glory.S02.COMPLETE.1080p.NF.WEB-DL", { query: "The Glory", season: 2 }],
    ["Moving S01E05-E06 720p", { query: "Moving", season: 1, episode: 5 }],
    ["Show_Name_1x03_HDTV", { query: "Show Name", season: 1, episode: 3 }],
    ["Queen of Tears Season 1 Episode 4", { query: "Queen of Tears", season: 1, episode: 4 }],
    ["Lovely Runner E07 240101 1080p", { query: "Lovely Runner", episode: 7 }],
    ["[SubsPlease] Frieren - 05 (1080p) [ABCD1234].mkv", { query: "Frieren", episode: 5 }],
    ["Doctor X", { query: "Doctor X" }],
    ["A Complete Unknown 2024 1080p", { query: "A Complete Unknown", year: 2024 }],
    ["Mad Max Fury Road 2015", { query: "Mad Max Fury Road", year: 2015 }],
    ["Signal 2016 S01 1080p", { query: "Signal", season: 1, year: 2016 }],
    ["Mr. Sunshine S01E01 1080p", { query: "Mr Sunshine", season: 1, episode: 1 }],
    ["Show.Name.S01.part1.rar", { query: "Show Name", season: 1 }],
  ])("%s", (name, expected) => {
    expect(matchTitleFromRelease(name)).toEqual(expected);
  });
});
