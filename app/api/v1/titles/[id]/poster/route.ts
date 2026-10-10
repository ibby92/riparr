import fs from "node:fs/promises";
import { api, ApiError, idParam } from "@/lib/api";
import { configDir } from "@/lib/db";
import { cachePoster, posterFile, sniffImageType } from "@/lib/media-cover";
import { fetchFor } from "@/lib/net";
import { getTitle } from "@/lib/titles";

/** The title's TMDB poster, downloaded once into /config/MediaCover. 404 if it has none. */
export const GET = api(async (req, ctx: RouteContext<"/api/v1/titles/[id]/poster">) => {
  const title = getTitle(await idParam(ctx));
  if (!title?.tmdb_id || !title.poster_path) throw new ApiError(404, "No poster");
  // The URL is per title id, but the poster changes with the TMDB match (and ids of deleted titles are
  // reused), so browsers revalidate against this tag instead of caching blindly.
  const etag = `"${title.type}-${title.tmdb_id}-${title.poster_path.replace(/[^\w.-]/g, "")}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
  }

  let file = await posterFile(title.tmdb_id, title.type, configDir());
  if (!file) {
    const cached = await cachePoster(
      { tmdbId: title.tmdb_id, type: title.type, posterPath: title.poster_path },
      { configDir: configDir(), fetch: fetchFor("host") },
    ).catch(() => null);
    file = cached?.path ?? null;
  }
  if (!file) throw new ApiError(404, "Poster unavailable");

  const bytes = await fs.readFile(file);
  return new Response(bytes, {
    headers: {
      "Content-Type": sniffImageType(bytes) ?? "image/jpeg",
      "Cache-Control": "private, no-cache",
      ETag: etag,
    },
  });
});
