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
const { containerInput, createContainer, listContainers } = await import("@/lib/containers");
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

  it("routes encrypted links to the container whose page sent them", async () => {
    const id = createContainer(
      containerInput.parse({
        name: "Captcha Show",
        url: "https://www.crate.example/folder/abc/",
        password: "",
        poll_interval_min: "60",
        target_dir: "tv/Captcha Show",
        path_template: "{filename}",
        enabled: "on",
      }),
    );
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

  it("creates a non-polled container for pages it doesn't know, using the Click'n'Load settings", async () => {
    saveSettings({ cnlTargetDir: "incoming", cnlTemplate: "{container}/{filename}" });
    await post("/flash/add", { urls: "https://gofile.io/d/xyz\nnot a link\n", source: "https://other.example/c/42" });
    await post("/flash/add", { urls: "https://gofile.io/d/xyz", source: "https://other.example/c/42/" });

    const created = listContainers().find((c) => c.url === "https://other.example/c/42");
    expect(created).toMatchObject({
      name: "other.example 42",
      poll: 0,
      enabled: 1,
      target_dir: "incoming",
      path_template: "{container}/{filename}",
    });
    expect(listLinks(created!.id).map((l) => l.url)).toEqual(["https://gofile.io/d/xyz"]);
  });

  it("uses a shared fallback container when there's no source", async () => {
    await post("/flash/add", { urls: "https://mega.nz/file/a#k" });
    await post("/flash/add", { urls: "https://mega.nz/file/b#k" });
    const fallback = listContainers().filter((c) => c.name === "Click'n'Load");
    expect(fallback).toHaveLength(1);
    expect(listLinks(fallback[0].id)).toHaveLength(2);
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
    const container = listContainers().find((c) => c.url === "https://dlc.example/c/7")!;
    expect(listLinks(container.id).map((l) => l.url).sort()).toEqual([
      "https://gofile.io/d/dlc1",
      "https://pixeldrain.com/u/dlc2",
    ]);
  });
});
