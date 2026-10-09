import { describe, expect, it } from "vitest";
import { HostOfflineError, RateLimitError } from "@/lib/errors";
import { fetchJson, httpOpener, parseRetryAfter } from "./http";

const signal = new AbortController().signal;

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; headers: Headers }[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init.headers) });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

const text = async (s: ReadableStream<Uint8Array>) => new Response(s).text();

describe("httpOpener", () => {
  it("sends no Range at offset 0", async () => {
    const f = fakeFetch(() => new Response("hello"));
    const opened = await httpOpener("https://h.test/f", { fetch: f.fn })(0, signal);
    expect(f.calls[0].headers.get("range")).toBeNull();
    expect(f.calls[0].headers.get("user-agent")).toMatch(/Mozilla/);
    expect(opened.offset).toBe(0);
    expect(await text(opened.body)).toBe("hello");
  });

  it("honours 206 with the Content-Range start", async () => {
    const f = fakeFetch((_, init) => {
      const range = new Headers(init.headers).get("range");
      expect(range).toBe("bytes=5-");
      return new Response("world", { status: 206, headers: { "content-range": "bytes 5-9/10" } });
    });
    const opened = await httpOpener("https://h.test/f", { fetch: f.fn, headers: { cookie: "a=b" } })(5, signal);
    expect(f.calls[0].headers.get("cookie")).toBe("a=b");
    expect(opened.offset).toBe(5);
    expect(await text(opened.body)).toBe("world");
  });

  it("reports offset 0 when the host ignores Range", async () => {
    const f = fakeFetch(() => new Response("helloworld"));
    const opened = await httpOpener("https://h.test/f", { fetch: f.fn })(5, signal);
    expect(opened.offset).toBe(0);
  });

  it("maps 404/410 to HostOfflineError", async () => {
    for (const status of [404, 410]) {
      const f = fakeFetch(() => new Response("gone", { status }));
      await expect(httpOpener("https://h.test/f", { fetch: f.fn })(0, signal)).rejects.toBeInstanceOf(HostOfflineError);
    }
  });

  it("maps 429/503 with Retry-After to RateLimitError", async () => {
    const f = fakeFetch(() => new Response("", { status: 429, headers: { "retry-after": "120" } }));
    const err = await httpOpener("https://h.test/f", { fetch: f.fn })(0, signal).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBe(120_000);

    const g = fakeFetch(() => new Response("", { status: 503, headers: { "retry-after": "7" } }));
    const err2 = await httpOpener("https://h.test/f", { fetch: g.fn })(0, signal).catch((e) => e);
    expect(err2).toBeInstanceOf(RateLimitError);
    expect(err2.retryAfterMs).toBe(7000);
  });

  it("maps other failures to a plain Error", async () => {
    const f = fakeFetch(() => new Response("", { status: 503 }));
    const err = await httpOpener("https://h.test/f", { fetch: f.fn })(0, signal).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RateLimitError);
  });

  it("lets mapError override", async () => {
    const f = fakeFetch(() => new Response("{}", { status: 403 }));
    const err = await httpOpener("https://h.test/f", {
      fetch: f.fn,
      mapError: async () => new HostOfflineError("custom"),
    })(0, signal).catch((e) => e);
    expect(err).toBeInstanceOf(HostOfflineError);
  });
});

describe("fetchJson", () => {
  it("parses JSON and maps errors", async () => {
    const ok = fakeFetch(() => Response.json({ a: 1 }));
    expect(await fetchJson("https://h.test/x", { fetch: ok.fn })).toEqual({ a: 1 });
    const gone = fakeFetch(() => Response.json({}, { status: 404 }));
    await expect(fetchJson("https://h.test/x", { fetch: gone.fn })).rejects.toBeInstanceOf(HostOfflineError);
  });
});

describe("parseRetryAfter", () => {
  it("handles seconds and dates", () => {
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 0)).toBe(10_000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});
