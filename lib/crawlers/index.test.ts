import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NeedsAttentionError } from "@/lib/errors";
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
    await expect(crawl(() => html("gone", 404)).promise).rejects.toThrow(/^HTTP 404/);
    const cf = crawl(() => html("<title>Just a moment...</title><script>window._cf_chl_opt={}</script>", 403));
    await expect(cf.promise).rejects.toBeInstanceOf(NeedsAttentionError);
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
