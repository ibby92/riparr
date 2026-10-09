import { describe, expect, it } from "vitest";
import { HostOfflineError, NeedsAttentionError, RateLimitError } from "@/lib/errors";
import { pixeldrain, parsePixeldrainUrl } from "./pixeldrain";
import type { ResolveOptions } from "./types";

const signal = new AbortController().signal;

function routes(table: Record<string, () => Response>) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init.headers) });
    const route = table[url];
    return route ? route() : Response.json({ success: false, value: "not_found" }, { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const opts = (fetch: typeof globalThis.fetch, account: ResolveOptions["account"] = null): ResolveOptions => ({
  account,
  password: null,
  signal,
  fetch,
});

const fileInfo = {
  success: true,
  id: "abc123",
  name: "Show.S01E01.mkv",
  size: 1048576,
  views: 3,
  bandwidth_used: 0,
  date_upload: "2026-09-01T00:00:00Z",
  mime_type: "video/x-matroska",
  hash_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  availability: "",
  availability_message: "",
  can_download: true,
};

const listInfo = {
  success: true,
  id: "LIST01",
  title: "Season 1",
  date_created: "2026-09-01T00:00:00Z",
  file_count: 2,
  files: [
    { detail_href: "/file/f1/info", id: "f1", name: "E01.mkv", size: 10 },
    { detail_href: "/file/f2/info", id: "f2", name: "E02.mkv", size: 20 },
  ],
};

describe("pixeldrain URLs", () => {
  it("matches file and list links on all domains", () => {
    for (const u of [
      "https://pixeldrain.com/u/abc123",
      "https://pixeldrain.net/u/abc123",
      "https://pixeldra.in/u/abc123",
      "https://www.pixeldrain.com/l/LIST01",
      "https://pixeldrain.com/api/file/abc123",
      "https://pixeldrain.com/api/file/abc123/info",
    ]) {
      expect(pixeldrain.matches(new URL(u)), u).toBe(true);
    }
    expect(parsePixeldrainUrl(new URL("https://pixeldrain.com/l/LIST01#item=2"))).toEqual({ kind: "list", id: "LIST01" });
    expect(pixeldrain.matches(new URL("https://pixeldrain.com/"))).toBe(false);
    expect(pixeldrain.matches(new URL("https://example.com/u/abc123"))).toBe(false);
  });
});

describe("pixeldrain resolve", () => {
  it("resolves a file with sha256 and downloads with ?download", async () => {
    const r = routes({
      "https://pixeldrain.com/api/file/abc123/info": () => Response.json(fileInfo),
      "https://pixeldrain.com/api/file/abc123?download": () =>
        new Response("data", { status: 206, headers: { "content-range": "bytes 4-7/8" } }),
    });
    const [f, ...rest] = await pixeldrain.resolve(new URL("https://pixeldra.in/u/abc123"), opts(r.fetch));
    expect(rest).toHaveLength(0);
    expect(f).toMatchObject({ key: "abc123", name: "Show.S01E01.mkv", dir: "", size: 1048576 });
    expect(f.hash).toEqual({ algo: "sha256", value: fileInfo.hash_sha256 });
    const opened = await f.open(4, signal);
    expect(opened.offset).toBe(4);
    expect(r.calls.at(-1)!.headers.get("range")).toBe("bytes=4-");
  });

  it("resolves a list to many files", async () => {
    const r = routes({ "https://pixeldrain.com/api/list/LIST01": () => Response.json(listInfo) });
    const files = await pixeldrain.resolve(new URL("https://pixeldrain.com/l/LIST01"), opts(r.fetch));
    expect(files.map((f) => [f.key, f.name, f.dir, f.size, f.hash])).toEqual([
      ["f1", "E01.mkv", "", 10, null],
      ["f2", "E02.mkv", "", 20, null],
    ]);
  });

  it("sends the API key as Basic auth with empty username", async () => {
    const r = routes({ "https://pixeldrain.com/api/file/abc123/info": () => Response.json(fileInfo) });
    await pixeldrain.resolve(new URL("https://pixeldrain.com/u/abc123"), opts(r.fetch, { apiKey: "secret" }));
    expect(r.calls[0].headers.get("authorization")).toBe(`Basic ${Buffer.from(":secret").toString("base64")}`);
  });

  it("maps 404 to HostOfflineError", async () => {
    const r = routes({});
    await expect(pixeldrain.resolve(new URL("https://pixeldrain.com/u/nope"), opts(r.fetch))).rejects.toBeInstanceOf(
      HostOfflineError,
    );
  });

  it("maps availability and download errors", async () => {
    const r = routes({
      "https://pixeldrain.com/api/file/abc123/info": () =>
        Response.json({ ...fileInfo, availability: "file_rate_limited_captcha_required", availability_message: "hotlink" }),
    });
    await expect(pixeldrain.resolve(new URL("https://pixeldrain.com/u/abc123"), opts(r.fetch))).rejects.toBeInstanceOf(
      NeedsAttentionError,
    );

    const d = routes({
      "https://pixeldrain.com/api/file/abc123/info": () => Response.json(fileInfo),
      "https://pixeldrain.com/api/file/abc123?download": () =>
        Response.json({ success: false, value: "transfer_limit_exceeded", message: "limit" }, { status: 403 }),
    });
    const [f] = await pixeldrain.resolve(new URL("https://pixeldrain.com/u/abc123"), opts(d.fetch));
    const err = await f.open(0, signal).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBeGreaterThan(0);
  });

  it("maps 429 to RateLimitError honouring Retry-After", async () => {
    const r = routes({
      "https://pixeldrain.com/api/list/LIST01": () => new Response("", { status: 429, headers: { "retry-after": "30" } }),
    });
    const err = await pixeldrain.resolve(new URL("https://pixeldrain.com/l/LIST01"), opts(r.fetch)).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBe(30_000);
  });
});
