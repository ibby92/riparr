import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  POSTER_MAX_BYTES,
  cachePoster,
  coverDir,
  posterFile,
  posterPathFor,
  removePosters,
  sniffImageType,
} from "./media-cover";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = new TextEncoder().encode("RIFF\x10\x00\x00\x00WEBPVP8 ");

let configDir: string;
beforeEach(async () => {
  configDir = await mkdtemp(path.join(os.tmpdir(), "riparr-mediacover-"));
});
afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
});

function fakeFetch(make: () => Response) {
  const urls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return make();
  }) as typeof fetch;
  return { fn, urls };
}

const image = (body: Uint8Array, type = "image/jpeg", extra: Record<string, string> = {}) => () =>
  new Response(body as BodyInit, { headers: { "content-type": type, ...extra } });

describe("sniffImageType", () => {
  it("recognizes JPEG, PNG, WebP and nothing else", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(WEBP)).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("cachePoster", () => {
  it("downloads once into MediaCover/<type>-<id>/poster-<size>.jpg, then skips", async () => {
    const f = fakeFetch(image(JPEG));
    const ref = { tmdbId: 240411, type: "show" as const, posterPath: "/dxposter.jpg" };
    const first = await cachePoster(ref, { configDir, fetch: f.fn });
    const expected = path.join(configDir, "MediaCover", "show-240411", "poster-w342.jpg");
    expect(first).toEqual({ path: expected, downloaded: true });
    expect(f.urls).toEqual(["https://image.tmdb.org/t/p/w342/dxposter.jpg"]);
    expect(new Uint8Array(await readFile(expected))).toEqual(JPEG);

    expect(await cachePoster(ref, { configDir, fetch: f.fn })).toEqual({ path: expected, downloaded: false });
    expect(f.urls).toHaveLength(1);

    expect(await cachePoster(ref, { configDir, fetch: f.fn, force: true })).toEqual({ path: expected, downloaded: true });
    expect(f.urls).toHaveLength(2);
    // No temp files left behind.
    expect(await readdir(path.dirname(expected))).toEqual(["poster-w342.jpg"]);
  });

  it("honours size and accepts PNG/WebP bodies", async () => {
    const png = await cachePoster(
      { tmdbId: 1, type: "movie", posterPath: "/a.png" },
      { configDir, fetch: fakeFetch(image(PNG, "image/png")).fn, size: "w500" },
    );
    expect(png?.path).toBe(path.join(configDir, "MediaCover", "movie-1", "poster-w500.jpg"));
    const webp = await cachePoster(
      { tmdbId: 2, type: "movie", posterPath: "/b.webp" },
      { configDir, fetch: fakeFetch(image(WEBP, "image/webp")).fn },
    );
    expect(webp?.downloaded).toBe(true);
  });

  it("returns null when the title has no poster", async () => {
    const f = fakeFetch(image(JPEG));
    expect(await cachePoster({ tmdbId: 1, type: "show", posterPath: null }, { configDir, fetch: f.fn })).toBeNull();
    expect(f.urls).toHaveLength(0);
  });

  it("rejects non-image content types", async () => {
    const f = fakeFetch(image(new TextEncoder().encode("<html></html>"), "text/html"));
    await expect(cachePoster({ tmdbId: 1, type: "show", posterPath: "/a.jpg" }, { configDir, fetch: f.fn })).rejects.toThrow(
      /not an image \(text\/html\)/,
    );
    expect(await posterFile(1, "show", configDir)).toBeNull();
  });

  it("rejects bodies whose magic bytes aren't an image", async () => {
    const f = fakeFetch(image(new TextEncoder().encode("GIF89a....")));
    await expect(cachePoster({ tmdbId: 1, type: "show", posterPath: "/a.jpg" }, { configDir, fetch: f.fn })).rejects.toThrow(
      /not a JPEG, PNG or WebP/,
    );
    expect(await posterFile(1, "show", configDir)).toBeNull();
  });

  it("enforces the size cap from Content-Length and while streaming", async () => {
    const declared = fakeFetch(image(JPEG, "image/jpeg", { "content-length": String(POSTER_MAX_BYTES + 1) }));
    await expect(
      cachePoster({ tmdbId: 1, type: "show", posterPath: "/a.jpg" }, { configDir, fetch: declared.fn }),
    ).rejects.toThrow(/too large/);
    const big = new Uint8Array(POSTER_MAX_BYTES + 10);
    big.set(JPEG);
    const streamed = fakeFetch(() => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < big.length; i += 1 << 20) c.enqueue(big.subarray(i, i + (1 << 20)));
          c.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "image/jpeg" } });
    });
    await expect(
      cachePoster({ tmdbId: 1, type: "show", posterPath: "/a.jpg" }, { configDir, fetch: streamed.fn }),
    ).rejects.toThrow(/too large/);
    expect(await posterFile(1, "show", configDir)).toBeNull();
  });

  it("surfaces HTTP errors", async () => {
    const f = fakeFetch(() => new Response("nope", { status: 404 }));
    await expect(cachePoster({ tmdbId: 1, type: "show", posterPath: "/a.jpg" }, { configDir, fetch: f.fn })).rejects.toThrow(
      "Poster download failed: HTTP 404",
    );
  });

  it("rejects unsafe ids, types, sizes and poster paths", async () => {
    const f = fakeFetch(image(JPEG));
    const opts = { configDir, fetch: f.fn };
    await expect(cachePoster({ tmdbId: -1, type: "show", posterPath: "/a.jpg" }, opts)).rejects.toThrow(/Invalid TMDB id/);
    await expect(cachePoster({ tmdbId: 1.5, type: "show", posterPath: "/a.jpg" }, opts)).rejects.toThrow(/Invalid TMDB id/);
    await expect(
      cachePoster({ tmdbId: "1/../../etc" as unknown as number, type: "show", posterPath: "/a.jpg" }, opts),
    ).rejects.toThrow(/Invalid TMDB id/);
    await expect(cachePoster({ tmdbId: 1, type: "../x" as "show", posterPath: "/a.jpg" }, opts)).rejects.toThrow(
      /Invalid media type/,
    );
    await expect(
      cachePoster({ tmdbId: 1, type: "show", posterPath: "/a.jpg" }, { ...opts, size: "../w1" as "w342" }),
    ).rejects.toThrow(/Invalid poster size/);
    for (const bad of ["/../../secret.jpg", "//evil.example/a.jpg", "/a/b.jpg", "a.jpg", "/a.svg"]) {
      await expect(cachePoster({ tmdbId: 1, type: "show", posterPath: bad }, opts)).rejects.toThrow(/Unexpected TMDB poster path/);
    }
    expect(f.urls).toHaveLength(0);
  });
});

describe("posterFile / removePosters", () => {
  it("finds and removes cached posters", async () => {
    expect(await posterFile(5, "movie", configDir)).toBeNull();
    const p = posterPathFor(5, "movie", configDir);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, JPEG);
    expect(await posterFile(5, "movie", configDir)).toBe(p);
    expect(await posterFile(5, "movie", configDir, "w500")).toBeNull();
    await removePosters(5, "movie", configDir);
    expect(await posterFile(5, "movie", configDir)).toBeNull();
    await removePosters(5, "movie", configDir); // idempotent
  });

  it("keeps paths inside MediaCover", () => {
    expect(coverDir(7, "show", configDir)).toBe(path.join(configDir, "MediaCover", "show-7"));
    expect(() => coverDir(0, "show", configDir)).toThrow();
    expect(() => coverDir(Number.NaN, "movie", configDir)).toThrow();
  });
});
