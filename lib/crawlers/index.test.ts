import { createCipheriv } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { NeedsAttentionError } from "@/lib/errors";
import { clearClearanceCache } from "./flaresolverr";
import { crawlContainer } from "./index";

type Handler = (url: string, init: RequestInit) => Response;

function fakeFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

const html = (body: string, status = 200, headers: HeadersInit = {}) =>
  new Response(`<!doctype html><html><body>${body}</body></html>`, {
    status,
    headers: { "content-type": "text/html", ...headers },
  });

function crawl(handler: Handler, password: string | null = null) {
  const f = fakeFetch(handler);
  return { promise: crawlContainer("https://paste.example/abc", { password, signal: new AbortController().signal, fetch: f.fn }), calls: f.calls };
}

function cnlForm(links: string[]) {
  const key = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
  let data = Buffer.from(links.join("\n"));
  data = Buffer.concat([data, Buffer.alloc((16 - (data.length % 16)) % 16)]);
  const c = createCipheriv("aes-128-cbc", key, key);
  c.setAutoPadding(false);
  const crypted = Buffer.concat([c.update(data), c.final()]).toString("base64");
  return `<form action="http://127.0.0.1:9666/flash/addcrypted2" method="post">
    <input type="hidden" name="jk" value="function f(){ return '${key.toString("hex")}';}">
    <input type="hidden" name="crypted" value="${crypted}"></form>`;
}

const CF_PAGE = "<title>Just a moment...</title><script>window._cf_chl_opt={}</script>";

beforeEach(() => clearClearanceCache());

describe("crawlContainer", () => {
  it("prefers CNL2 over plain links and sends browser-like headers", async () => {
    const { promise, calls } = crawl(() =>
      html(`${cnlForm(["https://gofile.io/d/a", "https://gofile.io/d/b"])} <a href="https://gofile.io/d/ad">ad</a>`),
    );
    expect(await promise).toEqual({ links: ["https://gofile.io/d/a", "https://gofile.io/d/b"], source: "cnl2" });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Mozilla/);
    expect(headers.Accept).toMatch(/text\/html/);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("falls back to plain links", async () => {
    const { promise } = crawl(() => html(`<pre>https://pixeldrain.com/u/x1\nhttps://pixeldrain.com/u/x2</pre>`));
    expect(await promise).toEqual({ links: ["https://pixeldrain.com/u/x1", "https://pixeldrain.com/u/x2"], source: "plain" });
  });

  it("treats an empty page as an empty container", async () => {
    expect(await crawl(() => html("<p>Nothing yet</p>")).promise).toEqual({ links: [], source: "none" });
  });

  it("maps HTTP errors", async () => {
    await expect(crawl(() => html("oops", 500)).promise).rejects.toThrow(/^HTTP 500/);
    const cf = crawl(() => html(CF_PAGE, 403));
    await expect(cf.promise).rejects.toBeInstanceOf(NeedsAttentionError);
    await expect(cf.promise).rejects.toThrow(/configure FlareSolverr in Settings/);
    expect(cf.calls).toHaveLength(1);
  });

  it("flags captchas", async () => {
    const p = crawl(() => html(`<form><div class="g-recaptcha" data-sitekey="x"></div></form>`)).promise;
    await expect(p).rejects.toThrow(NeedsAttentionError);
    await expect(p).rejects.toThrow(/Captcha required/);
  });

  it("asks for a password when none is set", async () => {
    const p = crawl(() => html(`<form method="post"><input type="password" name="pw"></form>`)).promise;
    await expect(p).rejects.toThrow(/password-protected/);
  });

  it("submits the password form and crawls the result", async () => {
    const { promise, calls } = crawl((url, init) => {
      if (init.method === "POST") {
        return init.body === "token=t1&pw=hunter2"
          ? html(`<a href="https://mega.nz/folder/x#y">files</a>`)
          : html(`<p>Wrong password</p><form method="post"><input type="password" name="pw"></form>`);
      }
      return html(`<form method="post" action="/unlock"><input type="hidden" name="token" value="t1">
        <input type="password" name="pw"><button type="submit" name="go">Go</button></form>`, 200, {
        "set-cookie": "sid=s1; Path=/; HttpOnly",
      });
    }, "hunter2");
    expect(await promise).toEqual({ links: ["https://mega.nz/folder/x#y"], source: "plain" });
    expect(calls[1].url).toBe("https://paste.example/unlock");
    expect((calls[1].init.headers as Record<string, string>).Cookie).toBe("sid=s1");
  });

  it("reports a rejected password", async () => {
    const page = `<form method="post"><input type="password" name="pw"></form>`;
    await expect(crawl(() => html(page), "nope").promise).rejects.toThrow(/rejected the password/);
  });

  it("reports DLC-only pages", async () => {
    const p = crawl(() => html(`<a href="/DLC/abc.dlc">DLC</a>`)).promise;
    await expect(p).rejects.toThrow(/DLC/);
  });
});

const FS = "http://fs:8191";
const FS_UA = "Mozilla/5.0 (X11; Linux x86_64) FlareSolverrChrome/142";
const CLEARANCE = { name: "cf_clearance", value: "cc1", domain: ".paste.example", expires: Math.floor(Date.now() / 1000) + 3600 };

type FsRequest = { cmd: string; url: string; postData?: string; cookies?: { name: string; value: string }[] };

const fsOk = (response: string, extra: { url?: string; cookies?: object[] } = {}) =>
  new Response(
    JSON.stringify({
      status: "ok",
      message: "Challenge solved!",
      solution: {
        url: extra.url ?? "https://paste.example/abc",
        status: 200,
        response: `<html><body>${response}</body></html>`,
        cookies: extra.cookies ?? [CLEARANCE],
        userAgent: FS_UA,
      },
    }),
    { headers: { "content-type": "application/json" } },
  );

/** Routes FlareSolverr API calls to `fs` and everything else to `site`. */
function crawlFs(
  site: (url: string, init: RequestInit) => Response,
  fs: (req: FsRequest) => Response,
  password: string | null = null,
) {
  const f = fakeFetch((url, init) => (url.startsWith(FS) ? fs(JSON.parse(String(init.body))) : site(url, init)));
  const promise = crawlContainer("https://paste.example/abc", {
    password,
    signal: new AbortController().signal,
    fetch: f.fn,
    flaresolverrUrl: `${FS}/`,
  });
  const siteCalls = () => f.calls.filter((c) => !c.url.startsWith(FS));
  const fsCalls = () => f.calls.filter((c) => c.url.startsWith(FS)).map((c) => JSON.parse(String(c.init.body)) as FsRequest);
  return { promise, siteCalls, fsCalls };
}

const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

describe("crawlContainer with FlareSolverr", () => {
  it("retries a challenged page through FlareSolverr and extracts links", async () => {
    const c = crawlFs(
      () => html(CF_PAGE, 403),
      () => fsOk(`<a href="https://gofile.io/d/fs1">x</a>`),
    );
    expect(await c.promise).toEqual({ links: ["https://gofile.io/d/fs1"], source: "plain" });
    expect(c.fsCalls()).toEqual([{ cmd: "request.get", url: "https://paste.example/abc", maxTimeout: 60_000 }]);
  });

  it("also retries a 200 challenge page (DDoS-Guard)", async () => {
    const c = crawlFs(
      () => html(`<title>DDoS-Guard</title><p>Checking your browser</p>`),
      () => fsOk(`https://pixeldrain.com/u/p1`),
    );
    expect(await c.promise).toEqual({ links: ["https://pixeldrain.com/u/p1"], source: "plain" });
  });

  it("doesn't call FlareSolverr for unchallenged pages", async () => {
    const c = crawlFs(
      () => html(`<a href="https://gofile.io/d/a">a</a>`),
      () => {
        throw new Error("unexpected");
      },
    );
    expect((await c.promise).links).toEqual(["https://gofile.io/d/a"]);
    expect(c.fsCalls()).toHaveLength(0);
  });

  it("reuses cached clearance cookies + UA on the next poll, and drops them when challenged again", async () => {
    const site = (_url: string, init: RequestInit) =>
      header(init, "Cookie") !== "cf_clearance=cc1" ? html(CF_PAGE, 403) : html(`<a href="https://gofile.io/d/z">z</a>`);
    const fs = () => fsOk(`<a href="https://gofile.io/d/z">z</a>`);

    const first = crawlFs(site, fs);
    await first.promise;
    expect(first.fsCalls()).toHaveLength(1);

    const second = crawlFs(site, fs);
    expect((await second.promise).links).toEqual(["https://gofile.io/d/z"]);
    expect(second.fsCalls()).toHaveLength(0);
    expect(header(second.siteCalls()[0].init, "Cookie")).toBe("cf_clearance=cc1");
    expect(header(second.siteCalls()[0].init, "User-Agent")).toBe(FS_UA);

    // Clearance revoked: the direct fetch is challenged, FlareSolverr is used again.
    const third = crawlFs(() => html(CF_PAGE, 403), () => fsOk(`<a href="https://gofile.io/d/z">z</a>`, { cookies: [] }));
    await third.promise;
    expect(third.fsCalls()).toHaveLength(1);
    // The new solve returned no cookies, so nothing is cached any more.
    const fourth = crawlFs(() => html(CF_PAGE, 403), () => fsOk(`<a href="https://gofile.io/d/z">z</a>`));
    await fourth.promise;
    expect(header(fourth.siteCalls()[0].init, "Cookie")).toBeUndefined();
  });

  it("maps a FlareSolverr error to NeedsAttentionError", async () => {
    const c = crawlFs(
      () => html(CF_PAGE, 403),
      () =>
        new Response(JSON.stringify({ status: "error", message: "Error: Error solving the challenge. Timeout after 60.0 seconds." }), {
          status: 500,
        }),
    );
    await expect(c.promise).rejects.toBeInstanceOf(NeedsAttentionError);
    await expect(c.promise).rejects.toThrow(/FlareSolverr.*Timeout after 60\.0 seconds/);
  });

  it("reports an unreachable FlareSolverr as a plain error", async () => {
    const c = crawlFs(
      () => html(CF_PAGE, 403),
      () => {
        throw new TypeError("fetch failed");
      },
    );
    await expect(c.promise).rejects.toThrow(/^FlareSolverr unreachable at http:\/\/fs:8191/);
    await expect(c.promise).rejects.not.toBeInstanceOf(NeedsAttentionError);
  });

  it("flags a page that is still a challenge after FlareSolverr", async () => {
    const c = crawlFs(() => html(CF_PAGE, 403), () => fsOk(CF_PAGE));
    await expect(c.promise).rejects.toBeInstanceOf(NeedsAttentionError);
    await expect(c.promise).rejects.toThrow(/after going through FlareSolverr/);
  });

  it("keeps captchas as needs-attention (FlareSolverr can't solve them)", async () => {
    const c = crawlFs(() => html(CF_PAGE, 403), () => fsOk(`<div class="h-captcha" data-sitekey="k"></div>`));
    await expect(c.promise).rejects.toThrow(/Captcha required.*Click'n'Load/);
  });

  const PW_FORM = `<form method="post" action="/unlock"><input type="hidden" name="token" value="t1">
    <input type="password" name="pw"></form>`;
  const SID = { name: "sid", value: "s1", domain: "paste.example" };

  it("submits the password form directly with FlareSolverr's cookies + UA", async () => {
    const c = crawlFs(
      (url, init) => {
        if (init.method === "POST" && header(init, "User-Agent") === FS_UA && /cf_clearance=cc1/.test(header(init, "Cookie"))) {
          return html(`<a href="https://mega.nz/folder/x#y">files</a>`);
        }
        return html(CF_PAGE, 403);
      },
      () => fsOk(PW_FORM, { cookies: [CLEARANCE, SID] }),
      "hunter 2",
    );
    expect(await c.promise).toEqual({ links: ["https://mega.nz/folder/x#y"], source: "plain" });
    const post = c.siteCalls()[1];
    expect(post.url).toBe("https://paste.example/unlock");
    expect(post.init.body).toBe("token=t1&pw=hunter+2");
    expect(header(post.init, "Cookie")).toBe("cf_clearance=cc1; sid=s1");
    expect(c.fsCalls()).toHaveLength(1);
  });

  it("falls back to FlareSolverr request.post when the direct submit is challenged", async () => {
    const c = crawlFs(
      () => html(CF_PAGE, 403),
      (req) =>
        req.cmd === "request.post"
          ? fsOk(`<a href="https://mega.nz/folder/x#y">files</a>`, { url: "https://paste.example/unlock" })
          : fsOk(PW_FORM, { cookies: [CLEARANCE, SID] }),
      "hunter 2",
    );
    expect(await c.promise).toEqual({ links: ["https://mega.nz/folder/x#y"], source: "plain" });
    expect(c.fsCalls()[1]).toEqual({
      cmd: "request.post",
      url: "https://paste.example/unlock",
      postData: "token=t1&pw=hunter%202",
      maxTimeout: 60_000,
      cookies: [
        { name: "cf_clearance", value: "cc1" },
        { name: "sid", value: "s1" },
      ],
    });
  });

  it("reports a wrong password through FlareSolverr", async () => {
    const c = crawlFs(
      () => html(CF_PAGE, 403),
      (req) => fsOk(req.cmd === "request.post" ? `<p>Wrong password</p>${PW_FORM}` : PW_FORM),
      "nope",
    );
    await expect(c.promise).rejects.toThrow(/rejected the password/);
  });
});

describe("removed source pages", () => {
  it.each([404, 410])("treats HTTP %i as needing attention, not a retryable error", async (status) => {
    const err = await crawlContainer("https://site.example/c/gone", {
      password: null,
      signal: new AbortController().signal,
      fetch: (async () => new Response("gone", { status })) as unknown as typeof fetch,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(NeedsAttentionError);
    expect(err.message).toMatch(/no longer exists/);
  });
});
