import crypto from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-cnl-"));
process.env.RIPARR_CONFIG_DIR = tmp;

const { closeDb } = await import("@/lib/db");
const { addRootFolder } = await import("@/lib/root-folders");
const { createSource, listSources, sourceInput } = await import("@/lib/sources");
const { createTitle, getTitle, titleInput } = await import("@/lib/titles");
const media = path.join(tmp, "media");
fs.mkdirSync(path.join(media, "Kdrama"), { recursive: true });
fs.mkdirSync(path.join(media, "TV"), { recursive: true });
/** Title id and source of the source whose URL is `url`. */
const sourceByUrl = (url: string) => listSources().find((s) => s.url === url)!;
const { listLinks } = await import("@/lib/links");
const { normalizePageUrl } = await import("@/lib/clicknload");
const { getSettings, saveSettings } = await import("@/lib/settings");
const { hostAccount, saveHostAccount } = await import("@/lib/host-accounts");
const { startCnlServer } = await import("./cnl-server");

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = await startCnlServer(0, "127.0.0.1");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function encrypt(links: string[]) {
  const key = crypto.randomBytes(16);
  const plain = Buffer.from(links.join("\r\n"));
  const padded = Buffer.concat([plain, Buffer.alloc((16 - (plain.length % 16)) % 16)]);
  const cipher = crypto.createCipheriv("aes-128-cbc", key, key).setAutoPadding(false);
  return {
    jk: `function f(){ return '${key.toString("hex")}';}`,
    crypted: Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64"),
  };
}

const post = (route: string, form: Record<string, string>) =>
  fetch(`${base}${route}`, { method: "POST", body: new URLSearchParams(form) });

describe("Click'n'Load listener", () => {
  it("answers JDownloader probes", async () => {
    const check = await fetch(`${base}/jdcheck.js`);
    expect(await check.text()).toContain("jdownloader=true");
    expect(check.headers.get("access-control-allow-origin")).toBe("*");
    expect(await (await fetch(`${base}/flash`)).text()).toBe("JDownloader");
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it("refuses pushes from unknown pages until there's a root folder", async () => {
    const res = await post("/flash/add", { urls: "https://gofile.io/d/early", source: "https://early.example/c/1" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Add a root folder");
  });

  it("routes encrypted links to the title whose source page sent them", async () => {
    const kdrama = addRootFolder(path.join(media, "Kdrama"));
    const id = createTitle(
      titleInput.parse({ type: "show", name: "Captcha Show", root_folder_id: kdrama, folder: "Captcha Show", season_folders: true, monitored: true }),
    );
    createSource(id, sourceInput.parse({ url: "https://www.crate.example/folder/abc/", poll: false }));
    const res = await post("/flash/addcrypted2", {
      ...encrypt(["https://pixeldrain.com/u/aaa", "https://pixeldrain.com/u/bbb"]),
      passwords: "",
      source: "https://crate.example/folder/abc#mirror-2",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("success\r\n");
    expect(listLinks(id).map((l) => l.url).sort()).toEqual([
      "https://pixeldrain.com/u/aaa",
      "https://pixeldrain.com/u/bbb",
    ]);
  });

  it("creates a show with a non-polled source in the default show root for pages it doesn't know", async () => {
    const tv = addRootFolder(path.join(media, "TV"));
    saveSettings({ defaultShowRootId: tv, defaultSeasonFolders: false });
    await post("/flash/add", { urls: "https://gofile.io/d/xyz\nnot a link\n", source: "https://other.example/c/42" });
    await post("/flash/add", { urls: "https://gofile.io/d/xyz", source: "https://other.example/c/42/" });

    const source = sourceByUrl("https://other.example/c/42");
    expect(source).toMatchObject({ poll: 0, enabled: 1, title_name: "other.example 42" });
    expect(getTitle(source.title_id)).toMatchObject({
      type: "show",
      root_path: path.join(media, "TV"),
      folder: "other.example 42",
      season_folders: 0,
    });
    expect(listLinks(source.title_id).map((l) => l.url)).toEqual(["https://gofile.io/d/xyz"]);
  });

  it("uses a shared fallback title when there's no source page", async () => {
    await post("/flash/add", { urls: "https://mega.nz/file/a#k" });
    await post("/flash/add", { urls: "https://mega.nz/file/b#k" });
    const fallback = listSources().filter((s) => s.title_name === "Click'n'Load");
    expect(fallback).toHaveLength(1);
    expect(listLinks(fallback[0].title_id)).toHaveLength(2);
  });

  it("rejects undecryptable payloads and oversized bodies", async () => {
    const bad = await post("/flash/addcrypted2", { jk: "function f(){ return 'zz'; }", crypted: "AAAA" });
    expect(bad.status).toBe(400);
    const huge = await fetch(`${base}/flash/add`, { method: "POST", body: "urls=" + "x".repeat(2 * 1024 * 1024) }).catch(
      () => null,
    );
    expect(huge === null || huge.status >= 400).toBe(true);
  });
});

describe("normalizePageUrl", () => {
  it.each([
    ["https://WWW.Example.com/a/b/", "https://example.com/a/b"],
    ["https://example.com/a?id=1#x", "https://example.com/a?id=1"],
    ["ftp://example.com/", null],
    ["not a url", null],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePageUrl(input)).toBe(expected);
  });
});

describe("settings and accounts", () => {
  it("round-trips settings over defaults", () => {
    saveSettings({ concurrency: 5, bytesPerSecond: 1048576, cnlEnabled: false });
    expect(getSettings()).toMatchObject({ concurrency: 5, perHost: 2, bytesPerSecond: 1048576, cnlEnabled: false });
  });

  it("stores non-empty credentials and deletes empty accounts", () => {
    saveHostAccount("pixeldrain", { apiKey: "key-1", other: "  " });
    expect(hostAccount("pixeldrain")).toEqual({ apiKey: "key-1" });
    saveHostAccount("pixeldrain", { apiKey: "" });
    expect(hostAccount("pixeldrain")).toBeNull();
  });
});

describe("Click'n'Load v1 (DLC)", () => {
  it("decrypts a DLC posted to /flash/addcrypted", async () => {
    const { makeDlc } = await import("@/lib/crawlers/dlc-fixture");
    const dlc = makeDlc([{ name: "pkg", links: ["https://gofile.io/d/dlc1", "https://pixeldrain.com/u/dlc2"] }]);
    const realFetch = globalThis.fetch;
    // Only JDownloader's service is faked; requests to the listener go through.
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
      new URL(String(input)).hostname === "service.jdownloader.org"
        ? new Response(`<rc>${dlc.rc}</rc>`)
        : realFetch(input, init)) as typeof fetch;
    try {
      const res = await post("/flash/addcrypted", { crypted: dlc.file, source: "https://dlc.example/c/7" });
      expect(await res.text()).toBe("success\r\n");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(listLinks(sourceByUrl("https://dlc.example/c/7").title_id).map((l) => l.url).sort()).toEqual([
      "https://gofile.io/d/dlc1",
      "https://pixeldrain.com/u/dlc2",
    ]);
  });
});
