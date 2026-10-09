import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { HostOfflineError, NeedsAttentionError, RateLimitError } from "@/lib/errors";
import { gofile, resetGofileGuest, websiteToken } from "./gofile";
import type { ResolveOptions } from "./types";

const signal = new AbortController().signal;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

type Call = { method: string; url: URL; headers: Headers };

function api(handler: (c: Call) => Response) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const c = { method: init.method ?? "GET", url: new URL(String(input)), headers: new Headers(init.headers) };
    calls.push(c);
    return handler(c);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const opts = (fetch: typeof globalThis.fetch, extra: Partial<ResolveOptions> = {}): ResolveOptions => ({
  account: null,
  password: null,
  signal,
  fetch,
  ...extra,
});

const ok = (data: unknown) =>
  Response.json({ status: "ok", data, metadata: { totalCount: 1, totalPages: 1, page: 1, pageSize: 1000, hasNextPage: false } });

const account = (token: string) =>
  Response.json({ status: "ok", data: { id: "acc", rootFolder: "root", tier: "guest", token } });

const file = (id: string, name: string, size: number, md5?: string) => ({
  id,
  parentFolder: "x",
  type: "file",
  name,
  createTime: 1790000000,
  size,
  downloadCount: 0,
  md5,
  mimetype: "video/x-matroska",
  servers: ["store1"],
  serverSelected: "store1",
  link: `https://store1.gofile.io/download/web/${id}/${encodeURIComponent(name)}`,
});

// Folder tree: ROOT -> [a.mkv, Season 1 -> [e1.mkv, Extras -> [bonus.mkv]]]
const tree: Record<string, object> = {
  ROOT: {
    canAccess: true,
    id: "root-id",
    type: "folder",
    name: "Show",
    code: "ROOT",
    children: {
      f1: file("f1", "a.mkv", 100, "d41d8cd98f00b204e9800998ecf8427e"),
      s1: { id: "s1", type: "folder", name: "Season 1", code: "S1CODE", childrenCount: 2 },
    },
  },
  s1: {
    canAccess: true,
    id: "s1",
    type: "folder",
    name: "Season 1",
    children: {
      f2: file("f2", "e1.mkv", 200),
      s2: { id: "s2", type: "folder", name: "Extras", childrenCount: 1 },
    },
  },
  s2: { canAccess: true, id: "s2", type: "folder", name: "Extras", children: { f3: file("f3", "bonus.mkv", 300) } },
};

beforeEach(() => resetGofileGuest());

describe("gofile", () => {
  it("matches folder links only", () => {
    expect(gofile.matches(new URL("https://gofile.io/d/AbC123"))).toBe(true);
    expect(gofile.matches(new URL("https://www.gofile.io/d/AbC123/"))).toBe(true);
    expect(gofile.matches(new URL("https://gofile.io/"))).toBe(false);
    expect(gofile.matches(new URL("https://store1.gofile.io/download/web/x/y"))).toBe(false);
  });

  it("creates a guest, recurses folders, and downloads with the token cookie", async () => {
    const a = api((c) => {
      if (c.method === "POST" && c.url.pathname === "/accounts") return account("TOKEN1");
      if (c.url.host === "store1.gofile.io") return new Response("bytes", { status: 206, headers: { "content-range": "bytes 10-14/15" } });
      const id = c.url.pathname.replace("/contents/", "");
      return tree[id] ? ok(tree[id]) : Response.json({ status: "error-notFound", data: {} }, { status: 404 });
    });
    const files = await gofile.resolve(new URL("https://gofile.io/d/ROOT"), opts(a.fetch));
    expect(files.map((f) => [f.key, f.name, f.dir, f.size])).toEqual([
      ["f1", "a.mkv", "", 100],
      ["f2", "e1.mkv", "Season 1", 200],
      ["f3", "bonus.mkv", "Season 1/Extras", 300],
    ]);
    expect(files[0].hash).toEqual({ algo: "md5", value: "d41d8cd98f00b204e9800998ecf8427e" });
    expect(files[1].hash).toBeNull();

    const contents = a.calls.find((c) => c.url.pathname === "/contents/ROOT")!;
    expect(contents.headers.get("authorization")).toBe("Bearer TOKEN1");
    expect(contents.headers.get("x-website-token")).toBe(websiteToken("TOKEN1"));
    expect(contents.headers.get("x-bl")).toBe("en-US");

    const opened = await files[2].open(10, signal);
    expect(opened.offset).toBe(10);
    const dl = a.calls.at(-1)!;
    expect(dl.headers.get("cookie")).toBe("accountToken=TOKEN1");
    expect(dl.headers.get("range")).toBe("bytes=10-");

    // Guest token is cached for the next resolve.
    await gofile.resolve(new URL("https://gofile.io/d/ROOT"), opts(a.fetch));
    expect(a.calls.filter((c) => c.url.pathname === "/accounts")).toHaveLength(1);
  });

  it("uses a premium token without creating a guest", async () => {
    const a = api((c) => ok(tree[c.url.pathname.replace("/contents/", "")]));
    await gofile.resolve(new URL("https://gofile.io/d/ROOT"), opts(a.fetch, { account: { token: "PREMIUM" } }));
    expect(a.calls.some((c) => c.url.pathname === "/accounts")).toBe(false);
    expect(a.calls[0].headers.get("authorization")).toBe("Bearer PREMIUM");
  });

  it("refreshes the guest token once on auth errors", async () => {
    let n = 0;
    const a = api((c) => {
      if (c.url.pathname === "/accounts") return account(`T${++n}`);
      if (c.headers.get("authorization") === "Bearer T1") return Response.json({ status: "error-notPremium", data: {} }, { status: 401 });
      return ok(tree.s2);
    });
    const files = await gofile.resolve(new URL("https://gofile.io/d/s2"), opts(a.fetch));
    expect(files).toHaveLength(1);
    expect(n).toBe(2);
  });

  it("gives NeedsAttention when the API keeps rejecting the website token", async () => {
    const a = api((c) =>
      c.url.pathname === "/accounts" ? account("T") : Response.json({ status: "error-notPremium", data: {} }),
    );
    await expect(gofile.resolve(new URL("https://gofile.io/d/X"), opts(a.fetch))).rejects.toBeInstanceOf(NeedsAttentionError);
  });

  it("sends the sha256 password and reports missing/wrong passwords", async () => {
    const locked = (status: string) => ({ canAccess: false, id: "p", type: "folder", name: "Locked", password: true, passwordStatus: status });
    const a = api((c) => {
      if (c.url.pathname === "/accounts") return account("T");
      const pw = c.url.searchParams.get("password");
      if (!pw) return ok(locked("passwordRequired"));
      if (pw !== sha256("hunter2")) return ok(locked("passwordWrong"));
      return ok({ ...tree.s2, password: true, passwordStatus: "passwordOk" });
    });
    const url = new URL("https://gofile.io/d/LOCKED");
    await expect(gofile.resolve(url, opts(a.fetch))).rejects.toThrow(/password required/);
    await expect(gofile.resolve(url, opts(a.fetch, { password: "nope" }))).rejects.toThrow(/wrong/);
    await expect(gofile.resolve(url, opts(a.fetch, { password: "nope" }))).rejects.toBeInstanceOf(NeedsAttentionError);
    const files = await gofile.resolve(url, opts(a.fetch, { password: "hunter2" }));
    expect(files.map((f) => f.name)).toEqual(["bonus.mkv"]);
  });

  it("maps notFound to HostOfflineError", async () => {
    const a = api((c) => (c.url.pathname === "/accounts" ? account("T") : Response.json({ status: "error-notFound", data: {} })));
    await expect(gofile.resolve(new URL("https://gofile.io/d/gone"), opts(a.fetch))).rejects.toBeInstanceOf(HostOfflineError);
  });

  it("maps rateLimit to RateLimitError", async () => {
    const a = api((c) =>
      c.url.pathname === "/accounts"
        ? account("T")
        : Response.json({ status: "error-rateLimit", data: {} }, { status: 429, headers: { "retry-after": "45" } }),
    );
    const err = await gofile.resolve(new URL("https://gofile.io/d/X"), opts(a.fetch)).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBe(45_000);
  });

  it("handles a code that points straight at a file", async () => {
    const a = api((c) => (c.url.pathname === "/accounts" ? account("T") : ok(file("f9", "movie.mkv", 9))));
    const files = await gofile.resolve(new URL("https://gofile.io/d/f9"), opts(a.fetch));
    expect(files.map((f) => [f.key, f.dir])).toEqual([["f9", ""]]);
  });
});
