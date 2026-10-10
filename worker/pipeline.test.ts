import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// End-to-end: source page (CNL2, crate-api) -> link diff -> resolve -> mirror selection -> download -> title folder.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-pipeline-"));
process.env.RIPARR_CONFIG_DIR = path.join(tmp, "config");
const downloads = path.join(tmp, "downloads");
fs.mkdirSync(downloads, { recursive: true });

const { closeDb } = await import("@/lib/db");
const { addRootFolder } = await import("@/lib/root-folders");
const { createSource, getSource, listSources, sourceInput } = await import("@/lib/sources");
const { createTitle, titleInput } = await import("@/lib/titles");
const { HostOfflineError } = await import("@/lib/errors");
const { RESOLVERS } = await import("@/lib/hosts");
const { httpOpener } = await import("@/lib/hosts/http");
const { listFiles, listLinks } = await import("@/lib/links");
const { checkSource } = await import("./check");
const { scheduleDownloads } = await import("./pipeline");
const { findSevenZip } = await import("./extract");
const { makeCrateSite } = await import("@/lib/crawlers/crate-fixture");
const crateSite = makeCrateSite("polltest");
const crateLinks: { url: string; host: string; label: string; episode: string; quality: string; size: string }[] = [];
const { one } = await import("@/lib/db");
const { execFileSync } = await import("node:child_process");

const files: Record<string, Buffer> = {
  "a.bin": crypto.randomBytes(200_000),
  "b.bin": crypto.randomBytes(50_000),
  "c.bin": crypto.randomBytes(10_000),
};
let published = ["a.bin", "b.bin"];
let base = "";

function cnl2Page(links: string[]) {
  const key = crypto.randomBytes(16);
  const plain = Buffer.from(links.join("\r\n"));
  const padded = Buffer.concat([plain, Buffer.alloc((16 - (plain.length % 16)) % 16)]);
  const cipher = crypto.createCipheriv("aes-128-cbc", key, key).setAutoPadding(false);
  const crypted = Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
  return `<html><body>
    <form action="http://127.0.0.1:9666/flash/addcrypted2" method="post">
      <input type="hidden" name="jk" value="function f(){ return '${key.toString("hex")}'; }">
      <input type="hidden" name="crypted" value="${crypted}">
      <input type="submit" value="Click'n'Load">
    </form></body></html>`;
}

// Mirror tests: two fake hosts serving the same files under /a/ and /b/.
const mirrorCrates: Record<string, string[]> = {};
const rawHits: string[] = [];
/** Per `${host}:${name}` HTTP status override for downloads: 404 (gone) or 429 (rate limited). */
const rawStatus = new Map<string, number>();

const server = http.createServer((req, res) => {
  const url = new URL(req.url!, base);
  if (url.pathname === "/c/polltest") {
    res.writeHead(200, { "content-type": "text/html", "set-cookie": "sess=1; Path=/" });
    res.end(crateSite.page);
    return;
  }
  if (url.pathname === crateSite.apiPath) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(crateSite.apiBody("Polled Show", crateLinks));
    return;
  }
  const mirrorCrate = /^\/mcrate\/(\w+)$/.exec(url.pathname)?.[1];
  if (mirrorCrate) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(cnl2Page(mirrorCrates[mirrorCrate].map((p) => `${base}${p}`)));
    return;
  }
  const mirrorRaw = /^\/raw([ab])\/(.+)$/.exec(url.pathname);
  if (mirrorRaw) {
    const [, host, name] = mirrorRaw;
    rawHits.push(`${host}:${name}`);
    const forced = rawStatus.get(`${host}:${name}`);
    if (forced) {
      res.writeHead(forced, forced === 429 ? { "retry-after": "3600" } : {}).end();
      return;
    }
    const body = files[name];
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-length": body.length });
    res.end(body);
    return;
  }
  if (url.pathname === "/crate2") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(cnl2Page([`${base}/u/show.zip`]));
    return;
  }
  if (url.pathname === "/crate") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(cnl2Page(published.map((name) => `${base}/u/${name}`)));
    return;
  }
  const name = url.pathname.replace(/^\/raw\//, "");
  const body = files[name];
  if (!url.pathname.startsWith("/raw/") || !body) {
    res.writeHead(404).end();
    return;
  }
  const start = Number(/^bytes=(\d+)-$/.exec(req.headers.range ?? "")?.[1] ?? 0);
  if (start > 0) {
    res.writeHead(206, { "content-range": `bytes ${start}-${body.length - 1}/${body.length}` });
    res.end(body.subarray(start));
  } else {
    res.writeHead(200, { "content-length": body.length });
    res.end(body);
  }
});

beforeAll(async () => {
  // Don't let a nearly full test machine pause the pipeline.
  (await import("@/lib/settings")).saveSettings({ minFreeGb: 0 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  RESOLVERS.push({
    id: "fakehost",
    matches: (u) => u.origin === base && u.pathname.startsWith("/u/"),
    async resolve(u) {
      const name = u.pathname.slice(3);
      if (!files[name]) throw new HostOfflineError("File not found");
      const sha256 = crypto.createHash("sha256").update(files[name]).digest("hex");
      return [
        {
          key: name,
          name,
          dir: "",
          size: files[name].length,
          hash: { algo: "sha256", value: sha256 },
          open: httpOpener(`${base}/raw/${name}`),
        },
      ];
    },
  });
});

beforeAll(() => {
  for (const host of ["a", "b"]) {
    RESOLVERS.push({
      id: `host${host}`,
      matches: (u) => u.origin === base && u.pathname.startsWith(`/${host}/`),
      async resolve(u) {
        const name = u.pathname.slice(3);
        return [{ key: name, name, dir: "", size: files[name]?.length ?? null, hash: null, open: httpOpener(`${base}/raw${host}/${name}`) }];
      },
    });
  }
});

afterAll(() => {
  server.close();
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

let rootId = 0;

/** A show in the test's downloads root with one polled source. */
function addTitle(opts: { name: string; url: string; folder: string; naming?: string; password?: string; seasonFolders?: boolean }) {
  rootId ||= addRootFolder(downloads);
  const id = createTitle(
    titleInput.parse({
      type: "show",
      name: opts.name,
      root_folder_id: rootId,
      folder: opts.folder,
      season_folders: opts.seasonFolders ?? false,
      naming: opts.naming ?? "{filename}",
      monitored: true,
    }),
  );
  createSource(id, sourceInput.parse({ url: opts.url, password: opts.password ?? "" }));
  return id;
}

/** Polls the title's (only) source, like the scheduler would. */
async function check(titleId: number, signal = new AbortController().signal) {
  const source = listSources(titleId)[0];
  return checkSource(getSource(source.id)!, signal);
}

async function drain(titleId: number, timeoutMs = 10_000) {
  const shutdown = new AbortController();
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      scheduleDownloads(shutdown.signal);
      const links = listLinks(titleId);
      if (links.every((l) => !["new", "queued", "resolving", "downloading"].includes(l.status))) return links;
      if (Date.now() > deadline) throw new Error(`Timed out: ${JSON.stringify(links.map((l) => l.status))}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  } finally {
    shutdown.abort();
  }
}

describe("pipeline", () => {
  let id: number;
  const signal = new AbortController().signal;
  const downloaded = (name: string) => path.join(tmp, "downloads", "tv", "Show", name);

  it("discovers links from a CNL2 page and downloads them into the title folder", async () => {
    id = addTitle({ name: "Show", url: `${base}/crate`, folder: "tv/Show", naming: "{dir}/{filename}" });

    const first = await check(id, signal);
    expect(first).toMatchObject({ status: "ok", newLinks: 2, source: "cnl2" });

    const links = await drain(id);
    expect(links.map((l) => [l.host, l.status])).toEqual([
      ["fakehost", "done"],
      ["fakehost", "done"],
    ]);
    expect(fs.readFileSync(downloaded("a.bin")).equals(files["a.bin"])).toBe(true);
    expect(fs.readFileSync(downloaded("b.bin")).equals(files["b.bin"])).toBe(true);
    expect(listFiles(links[0].id)[0]).toMatchObject({ status: "done", local_path: expect.stringMatching(new RegExp(`^${downloads}/tv/Show/`)) });
    expect(fs.readdirSync(path.join(tmp, "downloads", ".riparr-partial"))).toEqual([]);
  });

  it("re-polling finds nothing new", async () => {
    expect(await check(id, signal)).toMatchObject({ newLinks: 0 });
  });

  it("downloads only content added to the source later, and marks dead links offline", async () => {
    published = ["a.bin", "b.bin", "c.bin", "gone.bin"];
    expect(await check(id, signal)).toMatchObject({ newLinks: 2 });

    const links = await drain(id);
    const byName = Object.fromEntries(links.map((l) => [path.basename(l.url), l.status]));
    expect(byName).toEqual({ "a.bin": "done", "b.bin": "done", "c.bin": "done", "gone.bin": "offline" });
    expect(fs.readFileSync(downloaded("c.bin")).equals(files["c.bin"])).toBe(true);
    // a.bin wasn't fetched twice, so no "(1)" duplicate exists.
    expect(fs.readdirSync(path.dirname(downloaded("a.bin"))).sort()).toEqual(["a.bin", "b.bin", "c.bin"]);
  });
});

const sevenZip = await findSevenZip();

describe.skipIf(!sevenZip)("pipeline + extraction", () => {
  it("extracts a downloaded password-protected archive with the source's password", async () => {
    const work = fs.mkdtempSync(path.join(tmp, "zip-"));
    fs.writeFileSync(path.join(work, "Episode 01.mkv"), crypto.randomBytes(30_000));
    execFileSync(sevenZip!, ["a", "-tzip", "-ps3cret", "-mem=AES256", path.join(work, "show.zip"), path.join(work, "Episode 01.mkv")]);
    files["show.zip"] = fs.readFileSync(path.join(work, "show.zip"));

    const id = addTitle({ name: "Zipped", url: `${base}/crate2`, folder: "tv/Zipped", password: "s3cret" });
    expect(await check(id, new AbortController().signal)).toMatchObject({ newLinks: 1 });
    await drain(id);

    const extraction = async () => {
      for (let i = 0; i < 200; i++) {
        const row = one<{ status: string; files: number }>("SELECT status, files FROM extractions WHERE title_id = ?", id);
        if (row && row.status !== "incomplete") return row;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error("extraction never finished");
    };
    expect(await extraction()).toEqual({ status: "extracted", files: 1 });
    const out = path.join(tmp, "downloads", "tv", "Zipped");
    expect(fs.readdirSync(out).sort()).toEqual(["Episode 01.mkv", "show.zip"]);
    expect(fs.readFileSync(path.join(out, "Episode 01.mkv")).equals(fs.readFileSync(path.join(work, "Episode 01.mkv")))).toBe(true);
  });
});

describe("pipeline + preferred hosts", () => {
  const signal = new AbortController().signal;
  let n = 0;

  async function mirrorTitle(links: string[]) {
    const key = `m${++n}`;
    mirrorCrates[key] = links;
    const id = addTitle({ name: `Mirrors ${key}`, url: `${base}/mcrate/${key}`, folder: `mirrors/Mirrors ${key}` });
    await check(id, signal);
    return id;
  }
  const statuses = (id: number) => Object.fromEntries(listLinks(id).map((l) => [l.host, l.status]));
  const hitsFor = (name: string) => rawHits.filter((h) => h.endsWith(`:${name}`));
  const saved = (name: string) => fs.readFileSync(path.join(tmp, "downloads", "mirrors", `Mirrors m${n}`, name));

  beforeAll(async () => {
    (await import("@/lib/settings")).saveSettings({ hostPriority: ["hostb", "hosta"] });
    for (const name of ["m1.bin", "m2.bin", "m3.bin"]) files[name] = crypto.randomBytes(20_000);
  });

  it("downloads each file once, from the preferred host, and marks the other link as a mirror", async () => {
    const id = await mirrorTitle(["/a/m1.bin", "/b/m1.bin"]); // less preferred host listed first
    await drain(id);
    expect(statuses(id)).toEqual({ hosta: "mirror", hostb: "done" });
    expect(hitsFor("m1.bin")).toEqual(["b:m1.bin"]);
    expect(saved("m1.bin").equals(files["m1.bin"])).toBe(true);
  });

  it("falls back to the next host when the preferred copy is gone", async () => {
    rawStatus.set("b:m2.bin", 404);
    const id = await mirrorTitle(["/b/m2.bin", "/a/m2.bin"]);
    await drain(id);
    expect(statuses(id)).toEqual({ hosta: "done", hostb: "offline" });
    expect(hitsFor("m2.bin")).toEqual(["b:m2.bin", "a:m2.bin"]);
    expect(saved("m2.bin").equals(files["m2.bin"])).toBe(true);
  });

  it("uses another host instead of waiting out a rate limit", async () => {
    rawStatus.set("b:m3.bin", 429);
    const id = await mirrorTitle(["/b/m3.bin", "/a/m3.bin"]);
    await drain(id);
    // hostb's link would retry in an hour; its file was covered by hosta meanwhile.
    expect(statuses(id)).toEqual({ hosta: "done", hostb: "mirror" });
    expect(hitsFor("m3.bin")).toEqual(["b:m3.bin", "a:m3.bin"]);
    expect(saved("m3.bin").equals(files["m3.bin"])).toBe(true);
  });
});

describe("polling a JS-rendered source for new content", () => {
  const signal = new AbortController().signal;
  const episode = (ep: string) => {
    const label = `Polled.Show.${ep}.1080p.mkv`;
    files[label] = crypto.randomBytes(15_000);
    const meta = { label, episode: ep, quality: "1080p", size: "15 KB" };
    crateLinks.push(
      { url: `${base}/a/${label}`, host: "hosta", ...meta },
      { url: `${base}/b/${label}`, host: "hostb", ...meta },
      { url: `https://unsupported-host.example/f/${ep}`, host: "elsewhere", ...meta },
    );
    return label;
  };
  const byHost = (id: number, ep: string) =>
    Object.fromEntries(listLinks(id).filter((l) => l.episode === ep).map((l) => [l.host, l.status]));

  it("downloads what's there, then picks up an episode added later", async () => {
    (await import("@/lib/settings")).saveSettings({ hostPriority: ["hostb", "hosta"] });
    const e01 = episode("S01E01");
    // Season folders on: episodes land in "Polled Show/Season 01".
    const id = addTitle({ name: "Polled Show", url: `${base}/c/polltest`, folder: "tv/Polled Show", seasonFolders: true });

    expect(await check(id, signal)).toMatchObject({ status: "ok", newLinks: 3, source: "crate-api" });
    await drain(id);
    expect(byHost(id, "S01E01")).toEqual({ hostb: "done", hosta: "mirror", "unsupported-host.example": "ignored" });
    expect(listLinks(id).find((l) => l.host === "hostb")).toMatchObject({ label: e01, quality: "1080p", size_text: "15 KB" });

    // Nothing new: the next poll adds nothing.
    expect(await check(id, signal)).toMatchObject({ newLinks: 0 });

    // The site adds the next episode; the next poll registers and downloads just that.
    const e02 = episode("S01E02");
    expect(await check(id, signal)).toMatchObject({ newLinks: 3 });
    await drain(id);
    expect(byHost(id, "S01E02")).toEqual({ hostb: "done", hosta: "mirror", "unsupported-host.example": "ignored" });

    const dir = path.join(tmp, "downloads", "tv", "Polled Show", "Season 01");
    expect(fs.readdirSync(dir).sort()).toEqual([e01, e02]);
    expect(fs.readFileSync(path.join(dir, e02)).equals(files[e02])).toBe(true);
    expect(hitsFor(e01)).toEqual([`b:${e01}`]);
    expect(hitsFor(e02)).toEqual([`b:${e02}`]);
  });
});

const hitsFor = (name: string) => rawHits.filter((h) => h.endsWith(`:${name}`));
