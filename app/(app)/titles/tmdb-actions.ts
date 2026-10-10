"use server";

import { requireSession } from "@/lib/session";
import { NeedsAttentionError, RateLimitError } from "@/lib/errors";
import { fetchFor } from "@/lib/net";
import { getSettings } from "@/lib/settings";
import { createTmdbClient, matchTitleFromRelease, posterUrl, TmdbNotFoundError } from "@/lib/tmdb";
import { findTitleByTmdb } from "@/lib/titles";
import type { TmdbHit, TmdbDetails, ReleaseHint } from "./_add/types";

function client() {
  const { tmdbApiKey, tmdbLanguage } = getSettings();
  if (!tmdbApiKey) return null;
  return createTmdbClient({ apiKey: tmdbApiKey, language: tmdbLanguage, fetch: fetchFor("host") });
}

/** Plain-language TMDB failure for the UI. `needsKey` means the key is missing or rejected. */
function describe(err: unknown): { error: string; needsKey?: boolean } {
  if (err instanceof NeedsAttentionError) return { error: "TMDB didn't accept the API key. Check it under Settings → Connections.", needsKey: true };
  if (err instanceof RateLimitError) return { error: "TMDB is busy right now. Wait a few seconds and try again." };
  if (err instanceof TmdbNotFoundError) return { error: "TMDB doesn't know that title any more." };
  return { error: err instanceof Error ? err.message : "Couldn't reach TMDB" };
}

export type SearchResponse = { results: TmdbHit[]; error?: string; needsKey?: boolean };

/** Searches TMDB for shows, movies or both; marks results that are already in the library. */
export async function searchTmdb(query: string, type: "show" | "movie" | "all", year?: number): Promise<SearchResponse> {
  await requireSession();
  const q = String(query ?? "").trim().slice(0, 200);
  if (!q) return { results: [] };
  const tmdb = client();
  if (!tmdb) return { results: [], error: "Add a TMDB API key to search.", needsKey: true };
  const yr = Number.isInteger(year) && year! >= 1870 && year! <= 2200 ? year : undefined;
  try {
    const results = await tmdb.search(q, { type: type === "all" ? undefined : type, year: yr });
    return {
      results: results.slice(0, 20).map((r) => {
        const existing = findTitleByTmdb(r.type, r.tmdbId);
        return {
          tmdbId: r.tmdbId,
          type: r.type,
          title: r.title,
          originalTitle: r.originalTitle !== r.title ? r.originalTitle : null,
          year: r.year,
          overview: r.overview,
          posterPath: r.posterPath,
          posterUrl: posterUrl(r.posterPath, "w185"),
          inLibrary: existing ? { id: existing.id, name: existing.name } : null,
        };
      }),
    };
  } catch (err) {
    return { results: [], ...describe(err) };
  }
}

export type DetailsResponse = { details?: TmdbDetails; error?: string };

/** Extra facts for the picked match ("Returning Series · 16 episodes"). */
export async function tmdbDetails(type: "show" | "movie", tmdbId: number): Promise<DetailsResponse> {
  await requireSession();
  const tmdb = client();
  if (!tmdb || !Number.isSafeInteger(tmdbId) || tmdbId <= 0) return {};
  try {
    if (type === "show") {
      const s = await tmdb.show(tmdbId);
      const parts = [
        s.status,
        s.numberOfSeasons ? `${s.numberOfSeasons} season${s.numberOfSeasons === 1 ? "" : "s"}` : "",
        s.totalEpisodes ? `${s.totalEpisodes} episode${s.totalEpisodes === 1 ? "" : "s"}` : "",
      ];
      return { details: { summary: parts.filter(Boolean).join(" · "), totalEpisodes: s.totalEpisodes || null } };
    }
    const m = await tmdb.movie(tmdbId);
    const runtime = m.runtime ? `${Math.floor(m.runtime / 60)}h ${m.runtime % 60}m` : "";
    return { details: { summary: ["Movie", runtime, m.status].filter(Boolean).join(" · "), totalEpisodes: null } };
  } catch (err) {
    return describe(err);
  }
}

/**
 * Turns a pasted container URL or release name into a search (no network: only the text is read).
 * "https://mkvdrama.net/doctor-x-mafia-in-white" → { query: "doctor x mafia in white", url }.
 */
export async function hintFromPaste(text: string): Promise<ReleaseHint> {
  await requireSession();
  const raw = String(text ?? "").trim().slice(0, 2000);
  if (!raw) return { query: "" };
  let url: string | undefined;
  let name = raw;
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") {
      url = u.toString();
      const segments = u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
      // The last path segment that looks like words (not an opaque id) is usually the slug.
      const slug = [...segments].reverse().find((s) => /[a-z]{3,}.*[-_+.][a-z]/i.test(s)) ?? "";
      name = slug
        .replace(/\.(html?|php)$/i, "")
        .replace(/[-_+]+/g, " ")
        .split(" ")
        .filter((w) => !/^\d{5,}$/.test(w))
        .join(" ");
    }
  } catch {
    // Not a URL: treat it as a release name.
  }
  const m = matchTitleFromRelease(name);
  return { query: m.query, year: m.year, url };
}
