import { beforeEach, describe, expect, it } from "vitest";
import { NeedsAttentionError } from "@/lib/errors";
import {
  clearClearanceCache,
  cookiePairsFor,
  encodePostData,
  flaresolverrGet,
  flaresolverrPost,
  getClearance,
  normalizeFlareSolverrEndpoint,
  rememberClearance,
  testFlareSolverr,
} from "./flaresolverr";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ok = (solution: Record<string, unknown>) =>
  json({ status: "ok", message: "Challenge solved!", solution, startTimestamp: 1, endTimestamp: 2, version: "3.4.0" });

const signal = new AbortController().signal;

beforeEach(() => clearClearanceCache());

describe("normalizeFlareSolverrEndpoint", () => {
  it.each([
    ["http://fs:8191", "http://fs:8191"],
    ["http://fs:8191/", "http://fs:8191"],
    ["http://fs:8191/v1", "http://fs:8191"],
    ["http://fs:8191/v1/", "http://fs:8191"],
    [" fs:8191 ", "http://fs:8191"],
    ["https://proxy.lan/flaresolverr/v1", "https://proxy.lan/flaresolverr"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeFlareSolverrEndpoint(input)).toBe(expected);
  });

  it("rejects garbage", () => {
    expect(() => normalizeFlareSolverrEndpoint("ftp://fs")).toThrow(/Invalid FlareSolverr URL/);
  });
});

describe("flaresolverrGet", () => {
  it("posts request.get to /v1 and maps the solution", async () => {
    const f = fakeFetch(() =>
      ok({
        url: "https://paste.example/abc",
        status: 200,
        response: "<html>hi</html>",
        cookies: [{ name: "cf_clearance", value: "cc", domain: ".paste.example", expires: 2_000_000_000, httpOnly: true }],
        userAgent: "Mozilla/5.0 FS",
      }),
    );
    const r = await flaresolverrGet("http://fs:8191/v1/", "https://paste.example/abc", { signal, fetch: f.fn, maxTimeoutMs: 30_000 });
    expect(r).toEqual({
      status: 200,
      html: "<html>hi</html>",
      url: "https://paste.example/abc",
      cookies: [{ name: "cf_clearance", value: "cc", domain: ".paste.example", expires: 2_000_000_000 }],
      userAgent: "Mozilla/5.0 FS",
    });
    expect(f.calls[0].url).toBe("http://fs:8191/v1");
    expect(f.calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ cmd: "request.get", url: "https://paste.example/abc", maxTimeout: 30_000 });
  });

  it("maps status=error to NeedsAttentionError", async () => {
    const f = fakeFetch(() => json({ status: "error", message: "Error: Error solving the challenge. Timeout after 60.0 seconds." }, 500));
    const p = flaresolverrGet("http://fs:8191", "https://x.example/", { signal, fetch: f.fn });
    await expect(p).rejects.toBeInstanceOf(NeedsAttentionError);
    await expect(p).rejects.toThrow(/FlareSolverr.*Timeout after 60\.0 seconds/);
  });

  it("maps connection failures to a plain Error", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 10.0.0.5:8191") });
    });
    const p = flaresolverrGet("http://fs:8191", "https://x.example/", { signal, fetch: f.fn });
    await expect(p).rejects.toThrow(/^FlareSolverr unreachable at http:\/\/fs:8191 \(connect ECONNREFUSED/);
    await expect(p).rejects.not.toBeInstanceOf(NeedsAttentionError);
  });

  it("rejects non-FlareSolverr responses", async () => {
    const f = fakeFetch(() => new Response("<html>sonarr</html>", { status: 404 }));
    await expect(flaresolverrGet("http://fs:8191", "https://x.example/", { signal, fetch: f.fn })).rejects.toThrow(/unexpected response \(HTTP 404\)/);
  });

  it("rethrows the caller's abort as-is", async () => {
    const ac = new AbortController();
    ac.abort();
    const f = fakeFetch(() => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(flaresolverrGet("http://fs:8191", "https://x.example/", { signal: ac.signal, fetch: f.fn })).rejects.toThrow(/aborted/);
  });
});

describe("flaresolverrPost", () => {
  it("sends request.post with %20-encoded postData and cookies", async () => {
    const f = fakeFetch(() => ok({ url: "https://x.example/unlock", status: 200, response: "ok", cookies: [], userAgent: "UA" }));
    const body = new URLSearchParams({ pw: "a b+c&d", token: "t1" });
    await flaresolverrPost("http://fs:8191", "https://x.example/unlock", body, {
      signal,
      fetch: f.fn,
      cookies: [{ name: "sid", value: "s1" }],
    });
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({
      cmd: "request.post",
      url: "https://x.example/unlock",
      postData: "pw=a%20b%2Bc%26d&token=t1",
      maxTimeout: 60_000,
      cookies: [{ name: "sid", value: "s1" }],
    });
  });

  it("passes string postData through", () => {
    expect(encodePostData("a=b&c=d")).toBe("a=b&c=d");
  });
});

describe("testFlareSolverr", () => {
  it("reports the version from the index endpoint", async () => {
    const f = fakeFetch(() => json({ msg: "FlareSolverr is ready!", version: "3.4.0", userAgent: "UA" }));
    expect(await testFlareSolverr("http://fs:8191/v1", { fetch: f.fn })).toEqual({ ok: true, version: "3.4.0" });
    expect(f.calls[0].url).toBe("http://fs:8191/");
  });

  it("fails on something that isn't FlareSolverr", async () => {
    const f = fakeFetch(() => json({ hello: "world" }));
    expect(await testFlareSolverr("http://fs:8191", { fetch: f.fn })).toEqual({ ok: false, error: "http://fs:8191 doesn't look like FlareSolverr" });
  });

  it("fails when unreachable or misconfigured", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await testFlareSolverr("http://fs:8191", { fetch: f.fn })).toEqual({ ok: false, error: "FlareSolverr unreachable at http://fs:8191 (fetch failed)" });
    expect(await testFlareSolverr("ftp://nope")).toEqual({ ok: false, error: "Invalid FlareSolverr URL: ftp://nope" });
  });
});

describe("clearance cache", () => {
  const cookies = [
    { name: "cf_clearance", value: "cc", domain: ".paste.example", expires: 1_000 + 3600 },
    { name: "other", value: "o", domain: "elsewhere.example" },
  ];

  it("keys by origin and expires with cf_clearance", () => {
    rememberClearance("https://paste.example/abc", cookies, "UA", 1_000_000);
    expect(getClearance("https://paste.example/other", 1_000_000)?.userAgent).toBe("UA");
    expect(getClearance("https://other.example/abc", 1_000_000)).toBeNull();
    expect(getClearance("https://paste.example/abc", (1_000 + 3600) * 1000)).toBeNull();
  });

  it("caps the lifetime at 12h and defaults to 30min", () => {
    rememberClearance("https://a.example/", [{ name: "cf_clearance", value: "x", expires: 9_999_999_999 }], "UA", 0);
    expect(getClearance("https://a.example/", 12 * 3600_000 - 1)).not.toBeNull();
    expect(getClearance("https://a.example/", 12 * 3600_000)).toBeNull();
    rememberClearance("https://b.example/", [{ name: "cf_clearance", value: "x" }], "UA", 0);
    expect(getClearance("https://b.example/", 30 * 60_000)).toBeNull();
  });

  it("filters cookies by domain", () => {
    expect(cookiePairsFor(cookies, "https://www.paste.example/x")).toEqual(["cf_clearance=cc"]);
  });
});
