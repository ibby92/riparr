import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classify, deleteVolumes, extractSet, findArchiveSets, findSevenZip, type ArchiveSet } from "./extract";

describe("findArchiveSets", () => {
  const d = "/dl/movie";
  const p = (...names: string[]) => names.map((n) => `${d}/${n}`);

  it("returns a lone rar, 7z and zip as single-volume sets", () => {
    expect(findArchiveSets(p("a.rar", "b.7z", "c.zip", "readme.nfo", "film.mkv"))).toEqual([
      { entry: `${d}/a.rar`, volumes: [`${d}/a.rar`], name: "a" },
      { entry: `${d}/b.7z`, volumes: [`${d}/b.7z`], name: "b" },
      { entry: `${d}/c.zip`, volumes: [`${d}/c.zip`], name: "c" },
    ]);
  });

  it("groups partN.rar sets with part1 as entry, any padding, numeric order", () => {
    const sets = findArchiveSets(p("x.part10.rar", "x.part02.rar", "x.part01.rar", "x.part09.rar"));
    expect(sets).toEqual([
      {
        entry: `${d}/x.part01.rar`,
        volumes: p("x.part01.rar", "x.part02.rar", "x.part09.rar", "x.part10.rar"),
        name: "x",
      },
    ]);
    expect(findArchiveSets(p("y.part2.rar", "y.part1.rar"))[0].entry).toBe(`${d}/y.part1.rar`);
    expect(findArchiveSets(p("z.part001.rar"))[0].entry).toBe(`${d}/z.part001.rar`);
  });

  it("does not treat partN.rar as a plain rar", () => {
    const sets = findArchiveSets(p("Show.S01.part1.rar", "Show.S01.part2.rar"));
    expect(sets).toHaveLength(1);
    expect(sets[0].name).toBe("Show.S01");
  });

  it("groups old-style x.rar + x.r00, x.r01 with .rar first", () => {
    expect(findArchiveSets(p("x.r01", "x.r00", "x.rar", "x.r10"))).toEqual([
      { entry: `${d}/x.rar`, volumes: p("x.rar", "x.r00", "x.r01", "x.r10"), name: "x" },
    ]);
  });

  it("groups numbered splits (.7z.001, .zip.001, .rar.001, .001)", () => {
    const sets = findArchiveSets(p("a.7z.002", "a.7z.001", "b.zip.001", "c.001", "c.002", "c.003", "e.rar.001"));
    expect(sets).toEqual([
      { entry: `${d}/a.7z.001`, volumes: p("a.7z.001", "a.7z.002"), name: "a" },
      { entry: `${d}/b.zip.001`, volumes: p("b.zip.001"), name: "b" },
      { entry: `${d}/c.001`, volumes: p("c.001", "c.002", "c.003"), name: "c" },
      { entry: `${d}/e.rar.001`, volumes: p("e.rar.001"), name: "e" },
    ]);
  });

  it("groups split zips (x.zip + x.z01) with .zip as entry", () => {
    expect(findArchiveSets(p("x.z02", "x.zip", "x.z01"))).toEqual([
      { entry: `${d}/x.zip`, volumes: p("x.zip", "x.z01", "x.z02"), name: "x" },
    ]);
  });

  it("omits sets whose first volume is not there yet", () => {
    expect(findArchiveSets(p("x.part2.rar", "x.part3.rar", "y.r00", "z.7z.002", "w.z01"))).toEqual([]);
  });

  it("ignores .part partial downloads and .riparr-* dirs", () => {
    expect(
      findArchiveSets([
        ...p("x.part1.rar.part", "x.7z.part", "y.zip"),
        `${d}/.riparr-partial/z.rar`,
        `${d}/.riparr-extract-abc/inner.zip`,
      ]),
    ).toEqual([{ entry: `${d}/y.zip`, volumes: [`${d}/y.zip`], name: "y" }]);
  });

  it("keeps sets in different directories and of different kinds apart", () => {
    const sets = findArchiveSets(["/a/x.rar", "/b/x.rar", "/a/x.7z", "/a/x.7z.001"]);
    expect(sets.map((s) => s.entry)).toEqual(["/a/x.7z", "/a/x.7z.001", "/a/x.rar", "/b/x.rar"]);
  });

  it("matches extensions case-insensitively", () => {
    expect(findArchiveSets(p("X.PART1.RAR", "X.PART2.RAR", "Y.ZIP", "Y.Z01"))).toEqual([
      { entry: `${d}/X.PART1.RAR`, volumes: p("X.PART1.RAR", "X.PART2.RAR"), name: "X" },
      { entry: `${d}/Y.ZIP`, volumes: p("Y.ZIP", "Y.Z01"), name: "Y" },
    ]);
  });

  it("ignores non-archive look-alikes", () => {
    expect(findArchiveSets(p("x.r", "x.1", "x.01", "x.rar.nfo", "rar", ".rar.txt"))).toEqual([]);
  });
});

describe("classify", () => {
  it("prefers incomplete over password errors", () => {
    expect(classify(2, "ERROR: Missing volume : x.part2.rar\nData Error in encrypted file. Wrong password?")).toBe(
      "incomplete",
    );
    expect(classify(2, "ERRORS:\nUnexpected end of archive")).toBe("incomplete");
  });

  it("recognises password failures", () => {
    expect(classify(2, "Cannot open encrypted archive. Wrong password?")).toBe("wrong_password");
    expect(classify(2, "ERROR: Wrong password : a.txt")).toBe("wrong_password");
    expect(classify(2, "ERROR: CRC Failed in encrypted file. Wrong password? : a")).toBe("wrong_password");
  });

  it("treats exit 0/1 without errors as success and the rest as failure", () => {
    expect(classify(0, "")).toBe("ok");
    expect(classify(1, "WARNING: There are data after the end of archive")).toBe("ok");
    expect(classify(2, "Cannot open the file as archive")).toBe("failed");
  });
});

// Real-archive tests need a 7-Zip binary (RIPARR_7Z, 7z, 7zz or 7za); RAR ones also need `rar`.
const sevenZip = await findSevenZip();
const hasRar = spawnSync("rar", ["-iver"], { stdio: "ignore" }).status === 0;

function sh(bin: string, args: string[], cwd: string) {
  const r = spawnSync(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")} failed: ${r.stderr}${r.stdout}`);
}

/** Writes a stored (uncompressed) zip; `mode` sets unix permission bits (0o120777 = symlink). */
async function writeZip(file: string, entries: { name: string; data: string; mode?: number }[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const data = Buffer.from(e.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(file, Buffer.concat([...locals, cd, end]));
}

/** Pseudo-random bytes so 7-Zip can't compress volumes away. */
const noise = (n: number) => {
  const buf = Buffer.alloc(n);
  let x = 0x9e3779b9;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    buf[i] = x & 0xff;
  }
  return buf;
};

async function listTree(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    out.push(path.relative(base, p) + (e.isDirectory() ? "/" : ""));
    if (e.isDirectory()) out.push(...(await listTree(p, base)));
  }
  return out.sort();
}

describe.skipIf(!sevenZip)("extractSet (real 7-Zip)", () => {
  let root: string;
  let src: string;
  let out: string;
  const signal = new AbortController().signal;
  const opts = (passwords: string[] = []) => ({ sevenZip: sevenZip!, destDir: out, passwords, signal });
  const single = (file: string): ArchiveSet => ({ entry: file, volumes: [file], name: path.parse(file).name });

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "riparr-extract-"));
    src = path.join(root, "src");
    out = path.join(root, "out");
    await mkdir(path.join(src, "content", "sub"), { recursive: true });
    await writeFile(path.join(src, "content", "a.txt"), "hello");
    await writeFile(path.join(src, "content", "sub", "b.bin"), noise(300_000));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("extracts a plain zip and leaves no temp dir", async () => {
    sh(sevenZip!, ["a", "-tzip", "-bso0", path.join(src, "x.zip"), "."], path.join(src, "content"));
    const res = await extractSet(single(path.join(src, "x.zip")), opts());
    expect(res).toEqual({ status: "extracted", files: [path.join(out, "a.txt"), path.join(out, "sub", "b.bin")] });
    expect(await listTree(out)).toEqual(["a.txt", "sub/", "sub/b.bin"]);
    expect((await readFile(path.join(out, "sub", "b.bin"))).equals(noise(300_000))).toBe(true);
  });

  it("tries passwords in order (header-encrypted 7z)", async () => {
    sh(sevenZip!, ["a", "-bso0", "-psecret", "-mhe=on", path.join(src, "x.7z"), "."], path.join(src, "content"));
    const res = await extractSet(single(path.join(src, "x.7z")), opts(["nope", "secret"]));
    expect(res.status).toBe("extracted");
    expect(await readFile(path.join(out, "a.txt"), "utf8")).toBe("hello");
  });

  it("reports wrong_password when none match, with nothing left behind", async () => {
    sh(sevenZip!, ["a", "-bso0", "-psecret", path.join(src, "x.7z"), "."], path.join(src, "content"));
    expect(await extractSet(single(path.join(src, "x.7z")), opts(["nope", "nah"]))).toEqual({
      status: "wrong_password",
    });
    expect(await listTree(out)).toEqual([]);
  });

  it("extracts AES zip", async () => {
    sh(sevenZip!, ["a", "-tzip", "-mem=AES256", "-bso0", "-psecret", path.join(src, "x.zip"), "."], path.join(src, "content"));
    expect((await extractSet(single(path.join(src, "x.zip")), opts(["secret"]))).status).toBe("extracted");
    expect((await extractSet(single(path.join(src, "x.zip")), opts(["bad"]))).status).toBe("wrong_password");
  });

  it("reports incomplete for a multi-volume 7z with a missing volume, then extracts once complete", async () => {
    sh(sevenZip!, ["a", "-bso0", "-v100k", path.join(src, "x.7z"), "."], path.join(src, "content"));
    const all = (await readdir(src)).map((f) => path.join(src, f));
    const [set] = findArchiveSets(all);
    expect(set.volumes.length).toBeGreaterThanOrEqual(3);

    const hidden = path.join(root, "held");
    await writeFile(hidden, await readFile(set.volumes[1]));
    await rm(set.volumes[1]);
    expect(await extractSet(set, opts())).toEqual({ status: "incomplete" });
    expect(await listTree(out)).toEqual([]);

    await writeFile(set.volumes[1], await readFile(hidden));
    expect((await extractSet(set, opts())).status).toBe("extracted");
  });

  it("never overwrites existing files", async () => {
    sh(sevenZip!, ["a", "-tzip", "-bso0", path.join(src, "x.zip"), "."], path.join(src, "content"));
    await mkdir(path.join(out, "sub"), { recursive: true });
    await writeFile(path.join(out, "a.txt"), "mine");
    await writeFile(path.join(out, "sub", "b.bin"), "mine");
    const res = await extractSet(single(path.join(src, "x.zip")), opts());
    expect(res).toEqual({
      status: "extracted",
      files: [path.join(out, "a (1).txt"), path.join(out, "sub", "b (1).bin")],
    });
    expect(await readFile(path.join(out, "a.txt"), "utf8")).toBe("mine");
    const again = await extractSet(single(path.join(src, "x.zip")), opts());
    expect(again.status === "extracted" && again.files[0]).toBe(path.join(out, "a (2).txt"));
  });

  it("keeps traversal and absolute paths inside destDir and drops symlinks", async () => {
    const zip = path.join(src, "evil.zip");
    await writeZip(zip, [
      { name: "../evil.txt", data: "x" },
      { name: "../../evil2.txt", data: "x" },
      { name: "/tmp/riparr-abs-evil.txt", data: "x" },
      { name: "link", data: "/etc/passwd", mode: 0o120777 },
      { name: "ok.txt", data: "fine" },
    ]);
    const res = await extractSet(single(zip), opts());
    await expect(stat("/tmp/riparr-abs-evil.txt")).rejects.toThrow();
    expect(await listTree(root)).not.toContain("evil.txt");
    // 7-Zip strips "../" and leading "/"; the symlink is removed by us.
    expect(await listTree(out)).toEqual(["evil.txt", "evil2.txt", "ok.txt", "tmp/", "tmp/riparr-abs-evil.txt"]);
    expect(res.status).toBe("extracted");
    for (const f of res.status === "extracted" ? res.files : []) {
      expect(f.startsWith(out + path.sep)).toBe(true);
      expect((await stat(f)).isFile()).toBe(true);
    }
  });

  it("fails an archive with a symlink escaping the extract dir", async () => {
    const zip = path.join(src, "evil.zip");
    await writeZip(zip, [
      { name: "rel-link", data: "../../outside", mode: 0o120777 },
      { name: "ok.txt", data: "fine" },
    ]);
    const res = await extractSet(single(zip), opts());
    expect(res).toEqual({ status: "failed", error: expect.stringMatching(/Dangerous link/) });
    expect(await listTree(root)).not.toContain("outside");
    expect(await listTree(out)).toEqual([]);
  });

  it("fails cleanly on a non-archive", async () => {
    const file = path.join(src, "fake.rar");
    await writeFile(file, "not an archive");
    const res = await extractSet(single(file), opts(["a", "b"]));
    expect(res.status).toBe("failed");
    expect(await listTree(out)).toEqual([]);
  });

  it("throws when aborted", async () => {
    sh(sevenZip!, ["a", "-tzip", "-bso0", path.join(src, "x.zip"), "."], path.join(src, "content"));
    const ac = new AbortController();
    ac.abort();
    await expect(extractSet(single(path.join(src, "x.zip")), { ...opts(), signal: ac.signal })).rejects.toThrow();
  });

  it("deleteVolumes removes every volume and tolerates missing ones", async () => {
    sh(sevenZip!, ["a", "-bso0", "-v100k", path.join(src, "x.7z"), "."], path.join(src, "content"));
    const [set] = findArchiveSets((await readdir(src)).map((f) => path.join(src, f)));
    await rm(set.volumes[1]);
    await deleteVolumes(set);
    expect((await readdir(src)).sort()).toEqual(["content"]);
  });

  describe.skipIf(!hasRar)("RAR5 (needs `rar`)", () => {
    it("extracts an encrypted multi-part rar and reports missing parts as incomplete", async () => {
      sh("rar", ["a", "-inul", "-ma5", "-hpsecret", "-v100k", "-r", path.join(src, "x.rar"), "."], path.join(src, "content"));
      const [set] = findArchiveSets((await readdir(src)).map((f) => path.join(src, f)));
      expect(set.entry).toMatch(/x\.part0*1\.rar$/);

      const hidden = path.join(root, "held");
      await writeFile(hidden, await readFile(set.volumes[1]));
      await rm(set.volumes[1]);
      expect(await extractSet(set, opts(["secret"]))).toEqual({ status: "incomplete" });

      await writeFile(set.volumes[1], await readFile(hidden));
      expect((await extractSet(set, opts(["wrong"]))).status).toBe("wrong_password");
      const res = await extractSet(set, opts(["wrong", "secret"]));
      expect(res.status).toBe("extracted");
      expect((await readFile(path.join(out, "sub", "b.bin"))).equals(noise(300_000))).toBe(true);
    });
  });
});
