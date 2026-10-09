import { describe, expect, it } from "vitest";
import { NeedsAttentionError } from "@/lib/errors";
import { decryptDlc, DlcError, dlcLinks, metaFromFileName, parseDlcXml, splitDlc } from "./dlc";
import { makeDlc } from "./dlc-fixture";
import { crawlContainer, findDlcUrls } from "./index";

const b64 = (s: string) => Buffer.from(s).toString("base64");

function fakeService(rc: string | null, expectKey?: string) {
  return (async (url: string | URL | Request) => {
    const u = new URL(String(url));
    if (u.hostname === "service.jdownloader.org") {
      if (expectKey) expect(u.searchParams.get("data")).toBe(expectKey);
      return new Response(rc ? `<rc>${rc}</rc>` : "");
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
}

const links = ["https://gofile.io/d/abc", "https://pixeldrain.com/u/xyz"];

describe("decryptDlc", () => {
  it("decrypts packages and links via the service key", async () => {
    const dlc = makeDlc([{ name: "Show S01", links }, { name: "Extras", links: ["https://mega.nz/file/a#k", links[0]] }]);
    const packages = await decryptDlc(dlc.file, { fetch: fakeService(dlc.rc, dlc.serviceKey) });
    expect(packages).toMatchObject([
      { name: "Show S01", links },
      { name: "Extras", links: ["https://mega.nz/file/a#k", links[0]] },
    ]);
    expect(dlcLinks(packages)).toEqual([...links, "https://mega.nz/file/a#k"]);
  });

  it("tolerates whitespace and line breaks in the file", async () => {
    const dlc = makeDlc([{ name: "x", links }]);
    const wrapped = dlc.file.replace(/(.{76})/g, "$1\r\n") + "\n";
    expect(dlcLinks(await decryptDlc(wrapped, { fetch: fakeService(dlc.rc) }))).toEqual(links);
  });

  it("explains service rejections and outages", async () => {
    const dlc = makeDlc([{ name: "x", links }]);
    await expect(decryptDlc(dlc.file, { fetch: fakeService(null) })).rejects.toThrow(/rejected this container/);
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(decryptDlc(dlc.file, { fetch: down })).rejects.toThrow(/unreachable/);
  });

  it("rejects things that aren't DLC files", () => {
    expect(() => splitDlc("<html>nope</html>")).toThrow(DlcError);
    expect(() => splitDlc("abc")).toThrow(DlcError);
  });

  it("ignores non-http URLs and doesn't expand XML entities", () => {
    const xml = `<!DOCTYPE x [<!ENTITY e "boom">]><dlc><content><package name="${b64("p")}"><file><url>${b64("javascript:alert(1)")}</url></file><file><url>${b64("https://ok.example/f")}</url></file><file><url>&e;</url></file></package></content></dlc>`;
    expect(parseDlcXml(xml)).toMatchObject([{ name: "p", links: ["https://ok.example/f"] }]);
  });
});

describe("findDlcUrls", () => {
  it("finds .dlc hrefs and filecrypt-style DownloadDLC buttons", () => {
    const html = `<a href="/dl/abc.dlc">DLC</a> <a href='https://cdn.example/x.DLC?t=1'>x</a>
      <button onclick="DownloadDLC('f00d')">DLC</button> <a href="/not-a-dlc.html">no</a>`;
    expect(findDlcUrls(html, "https://crate.example/c/1")).toEqual([
      "https://crate.example/dl/abc.dlc",
      "https://cdn.example/x.DLC?t=1",
      "https://crate.example/DLC/f00d.dlc",
    ]);
  });
});

describe("crawlContainer with DLC", () => {
  const signal = new AbortController().signal;

  function site(page: string, dlcFile: string | null, rc: string | null) {
    return (async (url: string | URL | Request) => {
      const u = new URL(String(url));
      if (u.hostname === "service.jdownloader.org") return new Response(rc ? `<rc>${rc}</rc>` : "");
      if (u.pathname.endsWith(".dlc")) return dlcFile ? new Response(dlcFile) : new Response("gone", { status: 404 });
      return new Response(page, { headers: { "content-type": "text/html" } });
    }) as typeof fetch;
  }

  it("uses the page's DLC when there's no Click'n'Load", async () => {
    const dlc = makeDlc([{ name: "x", links }]);
    const result = await crawlContainer("https://crate.example/c/1", {
      password: null,
      signal,
      fetch: site(`<a href="/c/1/container.dlc">Download DLC</a>`, dlc.file, dlc.rc),
    });
    expect(result).toMatchObject({ links, source: "dlc" });
  });

  it("falls back to plain links when the DLC can't be decrypted", async () => {
    const dlc = makeDlc([{ name: "x", links }]);
    const result = await crawlContainer("https://crate.example/c/1", {
      password: null,
      signal,
      fetch: site(`<a href="/c/1/container.dlc">DLC</a> https://pixeldrain.com/u/plain1`, dlc.file, null),
    });
    expect(result).toEqual({ links: ["https://pixeldrain.com/u/plain1"], source: "plain" });
  });

  it("needs attention when the DLC is the only source and it fails", async () => {
    await expect(
      crawlContainer("https://crate.example/c/1", { password: null, signal, fetch: site(`<a href="/x.dlc">DLC</a>`, "garbage!", null) }),
    ).rejects.toThrow(NeedsAttentionError);
  });
});

describe("metaFromFileName", () => {
  it.each([
    [
      "Irreplaceable.S01E02.NF.x264.1080p[MkvDrama.net].mkv 665.21 MB",
      { label: "Irreplaceable.S01E02.NF.x264.1080p[MkvDrama.net].mkv", episode: "S01E02", quality: "1080p", size: "665.21 MB" },
    ],
    ["Movie.2024.2160p.mkv", { label: "Movie.2024.2160p.mkv", episode: undefined, quality: "2160p", size: undefined }],
    ["show s2e14 720P 1.4 GiB", { label: "show s2e14 720P", episode: "S2E14", quality: "720p", size: "1.4 GiB" }],
  ])("%j", (name, meta) => {
    expect(metaFromFileName(name)).toEqual(meta);
  });
});

describe("crawlContainer on viewcrate-style pages (DLC export)", () => {
  it("polls the site's DLC export and keeps per-file details", async () => {
    const dlc = makeDlc([{ name: "Show S01", links: ["https://pixeldrain.com/u/e1", "https://gofile.io/d/e1"] }]);
    // makeDlc has no filenames; add them so per-file details can be checked.
    const seen: string[] = [];
    const page = `<html><title>ViewCrate</title>
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
      <div id="r1" data-bootstrap-url="/c/abc123/bootstrap" data-resolve-url="/c/abc123/resolve-link" data-open-base-url="/c/abc123/open"></div></html>`;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(input));
      seen.push(`${u.pathname}${new Headers(init?.headers).get("cookie") ? " +cookie" : ""}`);
      if (u.hostname === "service.jdownloader.org") return new Response(`<rc>${dlc.rc}</rc>`);
      if (u.pathname === "/api/dlc_url/abc123") return Response.json({ url: "/dlc/abc123.dlc?t=1" });
      if (u.pathname === "/dlc/abc123.dlc") return new Response(dlc.file);
      return new Response(page, { headers: { "set-cookie": "vc_viewer=x; Path=/" } });
    }) as typeof fetch;

    const result = await crawlContainer("https://viewcrate.example/c/abc123", { password: null, signal: new AbortController().signal, fetch: fetchImpl });
    expect(result).toMatchObject({ source: "dlc-export", links: ["https://pixeldrain.com/u/e1", "https://gofile.io/d/e1"] });
    expect(seen).toEqual(["/c/abc123", "/api/dlc_url/abc123 +cookie", "/dlc/abc123.dlc +cookie", "/dlcrypt/service.php"]);
  });

  it("doesn't mistake Cloudflare's passive detection script for a challenge", async () => {
    const page = `<title>Normal</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script> https://pixeldrain.com/u/ok1`;
    const result = await crawlContainer("https://site.example/x", {
      password: null,
      signal: new AbortController().signal,
      fetch: (async () => new Response(page)) as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ source: "plain", links: ["https://pixeldrain.com/u/ok1"] });
  });
});
