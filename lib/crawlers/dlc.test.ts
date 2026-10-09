import { describe, expect, it } from "vitest";
import { NeedsAttentionError } from "@/lib/errors";
import { decryptDlc, DlcError, dlcLinks, parseDlcXml, splitDlc } from "./dlc";
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
    expect(packages).toEqual([
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
    expect(parseDlcXml(xml)).toEqual([{ name: "p", links: ["https://ok.example/f"] }]);
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
    expect(result).toEqual({ links, source: "dlc" });
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
