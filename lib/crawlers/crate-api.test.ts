import { describe, expect, it } from "vitest";
import { RateLimitError } from "@/lib/errors";
import { decryptCrateList, parseCrateLoader } from "./crate-api";
import { makeCrateSite } from "./crate-fixture";
import { crawlContainer } from "./index";

const links = [
  { url: "https://gofile.io/d/aaa", host: "gofile", label: "Show.S01E01.1080p.mkv", episode: "S01E01", quality: "1080p", size: "1.00 GB" },
  { url: "https://pixeldrain.com/u/bbb", host: "pixeldrain", label: "Show.S01E01.1080p.mkv", episode: "S01E01", quality: "1080p", size: "1.00 GB" },
];

describe("parseCrateLoader / decryptCrateList", () => {
  it("recovers the API path, key and IV from the obfuscated attributes", () => {
    const site = makeCrateSite("abcDEF123");
    const loader = parseCrateLoader(site.page)!;
    expect(loader.apiPath).toBe(site.apiPath);
    expect(loader.key.equals(site.key)).toBe(true);
    expect(loader.iv.equals(site.iv)).toBe(true);
  });

  it("decrypts the list and keeps only http(s) links", () => {
    const site = makeCrateSite("abc");
    const body = JSON.parse(site.apiBody("Show", [...links, { url: "javascript:alert(1)" }, { url: "" } as never]));
    expect(decryptCrateList(body.d, site.key, site.iv)).toEqual({ title: "Show", links });
  });

  it("rejects tampered data and ignores pages that aren't this engine", () => {
    const site = makeCrateSite("abc");
    const d = Buffer.from(JSON.parse(site.apiBody("x", links)).d, "base64");
    d[0] ^= 1;
    expect(() => decryptCrateList(d.toString("base64"), site.key, site.iv)).toThrow();
    expect(parseCrateLoader("<div id='w' data-s='x' data-p='c'></div>")).toBeNull();
    expect(parseCrateLoader(site.page.replace('data-p="c"', 'data-p="../evil"'))).toBeNull();
  });
});

describe("crawlContainer on crate-api pages", () => {
  const signal = new AbortController().signal;

  function site(apiStatus = 200, retryAfter?: string) {
    const s = makeCrateSite("xyz");
    const seen: { url: string; cookie: string | null }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const cookie = new Headers(init?.headers).get("cookie");
      seen.push({ url: url.pathname, cookie });
      if (url.pathname === s.apiPath) {
        return apiStatus === 200
          ? new Response(s.apiBody("Show", links), { headers: { "content-type": "application/json" } })
          : new Response("slow down", { status: apiStatus, headers: retryAfter ? { "retry-after": retryAfter } : {} });
      }
      return new Response(s.page, { headers: { "content-type": "text/html", "set-cookie": "sess=abc123; Path=/; HttpOnly" } });
    }) as typeof fetch;
    return { fetchImpl, seen };
  }

  it("returns the decrypted links with their details, sending the page's session cookie", async () => {
    const { fetchImpl, seen } = site();
    const result = await crawlContainer("https://crate.example/c/xyz", { password: null, signal, fetch: fetchImpl });
    expect(result.source).toBe("crate-api");
    expect(result.links).toEqual(links.map((l) => l.url));
    expect(result.items?.[0]).toMatchObject({ label: "Show.S01E01.1080p.mkv", episode: "S01E01", quality: "1080p" });
    expect(seen[1].cookie).toBe("sess=abc123");
  });

  it("turns the site's 429 into a RateLimitError with its Retry-After", async () => {
    const { fetchImpl } = site(429, "120");
    const err = await crawlContainer("https://crate.example/c/xyz", { password: null, signal, fetch: fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBe(120_000);
  });
});
