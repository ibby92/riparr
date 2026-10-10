import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { downloadFile } from "./download";
import { StallError } from "./errors";
import type { FileHash, RemoteFile } from "./hosts/types";

const SIZE = 1024 * 1024 + 123;
const DATA = (() => {
  const buf = Buffer.alloc(SIZE);
  let x = 0x2545f491;
  for (let i = 0; i < SIZE; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    buf[i] = x & 0xff;
  }
  return buf;
})();
const SHA256 = createHash("sha256").update(DATA).digest("hex");

let server: Server;
let baseUrl: string;
let dir: string;
const requests: { path: string; range: string | undefined }[] = [];

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://x");
    requests.push({ path: url.pathname, range: req.headers.range });
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    const start = url.pathname !== "/norange" && m ? Number(m[1]) : 0;
    const body = DATA.subarray(start);
    if (start > 0) {
      res.writeHead(206, { "content-range": `bytes ${start}-${SIZE - 1}/${SIZE}`, "content-length": body.length });
    } else {
      res.writeHead(200, { "content-length": body.length });
    }
    if (url.pathname === "/hang") {
      // Some bytes, then silence with the connection open.
      res.write(body.subarray(0, 100_000));
      return;
    }
    if (url.pathname !== "/slow") return res.end(body);
    // Trickle so the client can abort mid-way.
    for (let i = 0; i < body.length && !res.destroyed; i += 16 * 1024) {
      res.write(body.subarray(i, i + 16 * 1024));
      await new Promise((r) => setTimeout(r, 10));
    }
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(async () => {
  requests.length = 0;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = await mkdtemp(path.join(os.tmpdir(), "riparr-dl-"));
});

function remote(route = "/file", over: Partial<Pick<RemoteFile, "size" | "hash">> = {}): RemoteFile {
  return {
    key: "k1",
    name: "video.mkv",
    dir: "",
    size: SIZE,
    hash: null,
    ...over,
    async open(offset, signal) {
      const res = await fetch(baseUrl + route, { headers: offset ? { range: `bytes=${offset}-` } : {}, signal });
      const m = res.status === 206 ? /^bytes (\d+)-/.exec(res.headers.get("content-range") ?? "") : null;
      return { body: res.body!, offset: m ? Number(m[1]) : 0 };
    },
  };
}

const paths = () => ({
  finalPath: path.join(dir, "out", "Show", "video.mkv"),
  partialPath: path.join(dir, "partial", "k1.part"),
});

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

describe("downloadFile", () => {
  it("downloads a fresh file and reports final progress", async () => {
    const progress: [number, number | null][] = [];
    const p = paths();
    const res = await downloadFile(remote(), {
      ...p,
      signal: AbortSignal.timeout(10_000),
      onProgress: (d, t) => progress.push([d, t]),
    });
    expect(res).toEqual({ status: "done", path: p.finalPath, bytes: SIZE });
    expect((await readFile(p.finalPath)).equals(DATA)).toBe(true);
    expect(await exists(p.partialPath)).toBe(false);
    expect(progress.at(-1)).toEqual([SIZE, SIZE]);
    expect(progress.length).toBeLessThan(10);
  });

  it("aborts a transfer that stops sending bytes with StallError, keeping the partial for resume", async () => {
    const p = paths();
    const starts: number[] = [];
    const err = await downloadFile(remote("/hang"), {
      ...p,
      signal: AbortSignal.timeout(10_000),
      stallMs: 200,
      onStart: (o) => starts.push(o),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(StallError);
    expect(starts).toEqual([0]);
    expect((await stat(p.partialPath)).size).toBe(100_000);

    const res = await downloadFile(remote(), { ...p, signal: AbortSignal.timeout(10_000), stallMs: 200, onStart: (o) => starts.push(o) });
    expect(res.status).toBe("done");
    expect(starts).toEqual([0, 100_000]);
    expect(requests.at(-1)).toEqual({ path: "/file", range: "bytes=100000-" });
    expect((await readFile(p.finalPath)).equals(DATA)).toBe(true);
  });

  it("resumes from a partial file", async () => {
    const p = paths();
    await mkdir(path.dirname(p.partialPath), { recursive: true });
    await writeFile(p.partialPath, DATA.subarray(0, 300_000));
    const progress: number[] = [];
    const res = await downloadFile(remote(), {
      ...p,
      signal: AbortSignal.timeout(10_000),
      onProgress: (d) => progress.push(d),
    });
    expect(res.status).toBe("done");
    expect(requests).toEqual([{ path: "/file", range: "bytes=300000-" }]);
    expect((await readFile(p.finalPath)).equals(DATA)).toBe(true);
    expect(progress[0]).toBeGreaterThan(300_000);
  });

  it("restarts when the host ignores Range", async () => {
    const p = paths();
    await mkdir(path.dirname(p.partialPath), { recursive: true });
    await writeFile(p.partialPath, Buffer.alloc(300_000, 7)); // wrong bytes: must be discarded
    const res = await downloadFile(remote("/norange"), { ...p, signal: AbortSignal.timeout(10_000) });
    expect(res.status).toBe("done");
    expect((await readFile(p.finalPath)).equals(DATA)).toBe(true);
  });

  it("skips the network when the partial is already complete", async () => {
    const p = paths();
    await mkdir(path.dirname(p.partialPath), { recursive: true });
    await writeFile(p.partialPath, DATA);
    const res = await downloadFile(remote(), { ...p, signal: AbortSignal.timeout(10_000) });
    expect(res.status).toBe("done");
    expect(requests).toEqual([]);
  });

  it("verifies a matching hash (hex or base64)", async () => {
    const hex: FileHash = { algo: "sha256", value: SHA256.toUpperCase() };
    expect((await downloadFile(remote("/file", { hash: hex }), { ...paths(), signal: AbortSignal.timeout(10_000) })).status).toBe("done");
    await rm(paths().finalPath);
    const md5: FileHash = { algo: "md5", value: createHash("md5").update(DATA).digest("base64") };
    expect((await downloadFile(remote("/file", { hash: md5 }), { ...paths(), signal: AbortSignal.timeout(10_000) })).status).toBe("done");
  });

  it("deletes the partial and throws on hash mismatch", async () => {
    const p = paths();
    const hash: FileHash = { algo: "sha1", value: "0".repeat(40) };
    await expect(downloadFile(remote("/file", { hash }), { ...p, signal: AbortSignal.timeout(10_000) })).rejects.toThrow(/checksum/);
    expect(await exists(p.partialPath)).toBe(false);
    expect(await exists(p.finalPath)).toBe(false);
  });

  it("throws on size mismatch", async () => {
    const p = paths();
    await expect(downloadFile(remote("/file", { size: SIZE + 10 }), { ...p, signal: AbortSignal.timeout(10_000) })).rejects.toThrow(/size mismatch/i);
    expect(await exists(p.finalPath)).toBe(false);
  });

  it("accepts unknown size", async () => {
    const p = paths();
    const progress: [number, number | null][] = [];
    const res = await downloadFile(remote("/file", { size: null }), { ...p, signal: AbortSignal.timeout(10_000), onProgress: (d, t) => progress.push([d, t]) });
    expect(res).toEqual({ status: "done", path: p.finalPath, bytes: SIZE });
    expect(progress.at(-1)).toEqual([SIZE, null]);
  });

  it("skips when an identical final file exists", async () => {
    const p = paths();
    await downloadFile(remote(), { ...p, signal: AbortSignal.timeout(10_000) });
    requests.length = 0;
    expect(await downloadFile(remote(), { ...p, signal: AbortSignal.timeout(10_000) })).toEqual({ status: "skipped", path: p.finalPath });
    expect(requests).toEqual([]);
  });

  it("picks a suffixed name when a different final file exists, and skips it next time", async () => {
    const p = paths();
    await mkdir(path.dirname(p.finalPath), { recursive: true });
    await writeFile(p.finalPath, "something else");
    const res = await downloadFile(remote(), { ...p, signal: AbortSignal.timeout(10_000) });
    const suffixed = path.join(path.dirname(p.finalPath), "video (1).mkv");
    expect(res).toEqual({ status: "done", path: suffixed, bytes: SIZE });
    expect(await readFile(p.finalPath, "utf8")).toBe("something else");
    expect((await readFile(suffixed)).equals(DATA)).toBe(true);
    expect(await downloadFile(remote(), { ...p, signal: AbortSignal.timeout(10_000) })).toEqual({ status: "skipped", path: suffixed });
  });

  it("leaves the partial on abort and completes it on the next call", async () => {
    const p = paths();
    const ac = new AbortController();
    const err = await downloadFile(remote("/slow"), {
      ...p,
      signal: ac.signal,
      onProgress: (d) => d > 100_000 && ac.abort(),
    }).catch((e: unknown) => e);
    expect((err as Error).name).toBe("AbortError");
    const partial = (await stat(p.partialPath)).size;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(SIZE);
    expect(await exists(p.finalPath)).toBe(false);

    requests.length = 0;
    const res = await downloadFile(remote(), { ...p, signal: AbortSignal.timeout(10_000) });
    expect(res.status).toBe("done");
    expect(requests[0].range).toBe(`bytes=${partial}-`);
    expect((await readFile(p.finalPath)).equals(DATA)).toBe(true);
  });

  it("limits bandwidth", async () => {
    const t0 = Date.now();
    await downloadFile(remote(), { ...paths(), signal: AbortSignal.timeout(10_000), bytesPerSecond: 2 * 1024 * 1024 });
    // 1 MiB at 2 MiB/s with a 0.25 s burst: at least ~0.25 s.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(200);
  });
});
