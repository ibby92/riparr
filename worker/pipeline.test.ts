import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// End-to-end: container page (CNL2) -> link diff -> resolve -> download -> templated path.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-pipeline-"));
process.env.RIPARR_CONFIG_DIR = path.join(tmp, "config");
process.env.RIPARR_DOWNLOADS_DIR = path.join(tmp, "downloads");

const { closeDb } = await import("@/lib/db");
const { containerInput, createContainer, getContainer } = await import("@/lib/containers");
const { HostOfflineError } = await import("@/lib/errors");
const { RESOLVERS } = await import("@/lib/hosts");
const { httpOpener } = await import("@/lib/hosts/http");
const { listFiles, listLinks } = await import("@/lib/links");
const { checkContainer } = await import("./check");
const { scheduleDownloads } = await import("./pipeline");
const { findSevenZip } = await import("./extract");
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url!, base);
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

afterAll(() => {
  server.close();
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function drain(containerId: number, timeoutMs = 10_000) {
  const shutdown = new AbortController();
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      scheduleDownloads(shutdown.signal);
      const links = listLinks(containerId);
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

  it("discovers links from a CNL2 container and downloads them into the template path", async () => {
    id = createContainer(
      containerInput.parse({
        name: "Show",
        url: `${base}/crate`,
        password: "",
        poll_interval_min: "30",
        target_dir: "tv",
        path_template: "{container}/{dir}/{filename}",
        enabled: "on",
        poll: "on",
      }),
    );

    const first = await checkContainer(getContainer(id)!, signal);
    expect(first).toMatchObject({ status: "ok", newLinks: 2, source: "cnl2" });

    const links = await drain(id);
    expect(links.map((l) => [l.host, l.status])).toEqual([
      ["fakehost", "done"],
      ["fakehost", "done"],
    ]);
    expect(fs.readFileSync(downloaded("a.bin")).equals(files["a.bin"])).toBe(true);
    expect(fs.readFileSync(downloaded("b.bin")).equals(files["b.bin"])).toBe(true);
    expect(listFiles(links[0].id)[0]).toMatchObject({ status: "done", local_path: expect.stringMatching(/^tv\/Show\//) });
    expect(fs.readdirSync(path.join(tmp, "downloads", ".riparr-partial"))).toEqual([]);
  });

  it("re-polling finds nothing new", async () => {
    expect(await checkContainer(getContainer(id)!, signal)).toMatchObject({ newLinks: 0 });
  });

  it("downloads only content added to the container later, and marks dead links offline", async () => {
    published = ["a.bin", "b.bin", "c.bin", "gone.bin"];
    expect(await checkContainer(getContainer(id)!, signal)).toMatchObject({ newLinks: 2 });

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
  it("extracts a downloaded password-protected archive with the container's password", async () => {
    const work = fs.mkdtempSync(path.join(tmp, "zip-"));
    fs.writeFileSync(path.join(work, "Episode 01.mkv"), crypto.randomBytes(30_000));
    execFileSync(sevenZip!, ["a", "-tzip", "-ps3cret", "-mem=AES256", path.join(work, "show.zip"), path.join(work, "Episode 01.mkv")]);
    files["show.zip"] = fs.readFileSync(path.join(work, "show.zip"));

    const id = createContainer(
      containerInput.parse({
        name: "Zipped",
        url: `${base}/crate2`,
        password: "s3cret",
        poll_interval_min: "30",
        target_dir: "tv",
        path_template: "{container}/{filename}",
        enabled: "on",
        poll: "on",
      }),
    );
    expect(await checkContainer(getContainer(id)!, new AbortController().signal)).toMatchObject({ newLinks: 1 });
    await drain(id);

    const extraction = async () => {
      for (let i = 0; i < 200; i++) {
        const row = one<{ status: string; files: number }>("SELECT status, files FROM extractions WHERE container_id = ?", id);
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
