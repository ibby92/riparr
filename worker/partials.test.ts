import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-partials-"));
process.env.RIPARR_CONFIG_DIR = path.join(tmp, "config");
const root = path.join(tmp, "media");
const dir = path.join(root, ".riparr-partial");
fs.mkdirSync(dir, { recursive: true });

const { closeDb, run } = await import("@/lib/db");
const { addRootFolder } = await import("@/lib/root-folders");
const { createTitle, titleInput } = await import("@/lib/titles");
const { partialName, partialPathFor, sweepPartials } = await import("./partials");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const HOUR = 60 * 60 * 1000;
const write = (name: string, bytes: number, ageMs = 2 * HOUR) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.alloc(bytes));
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(p, t, t);
  return p;
};

describe("partialName", () => {
  it("differs for a reused file id with another link or file", () => {
    const a = partialName(8, "https://pixeldrain.com/u/a", "a");
    expect(a).toMatch(/^8-[0-9a-f]{12}\.part$/);
    expect(partialName(8, "https://pixeldrain.com/u/b", "b")).not.toBe(a);
    expect(partialName(8, "https://pixeldrain.com/u/a", "a")).toBe(a);
  });
});

describe("partialPathFor", () => {
  it("adopts a legacy <id>.part only when its size matches the file's recorded progress", () => {
    write("21.part", 500);
    const p = partialPathFor(dir, 21, "u21", "k", 500);
    expect(path.basename(p)).toBe(partialName(21, "u21", "k"));
    expect(fs.statSync(p).size).toBe(500);
    expect(fs.existsSync(path.join(dir, "21.part"))).toBe(false);

    write("22.part", 300); // someone else's bytes under a reused id
    const q = partialPathFor(dir, 22, "u22", "k", 0);
    expect(fs.existsSync(q)).toBe(false);
    expect(fs.existsSync(path.join(dir, "22.part"))).toBe(true);
  });
});

describe("sweepPartials", () => {
  it("removes old partials no unfinished file will resume, and keeps the rest", () => {
    const rootId = addRootFolder(root);
    const titleId = createTitle(titleInput.parse({ type: "show", name: "S", root_folder_id: rootId, folder: "S", naming: "{filename}", monitored: true }));
    run("INSERT INTO links (id, title_id, url, fingerprint, host, status, discovered_at) VALUES (1, ?, 'u1', 'f1', 'gofile', 'queued', 1)", titleId);
    run("INSERT INTO files (id, link_id, key, remote_name, status, bytes_done, updated_at) VALUES (31, 1, 'k31', 'a', 'queued', 0, 1)");
    run("INSERT INTO files (id, link_id, key, remote_name, status, bytes_done, updated_at) VALUES (32, 1, 'k32', 'b', 'done', 10, 1)");
    run("INSERT INTO files (id, link_id, key, remote_name, status, bytes_done, updated_at) VALUES (33, 1, 'k33', 'c', 'queued', 70, 1)");
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));

    const keep = write(partialName(31, "u1", "k31"), 40); // still to download
    const done = write(partialName(32, "u1", "k32"), 10); // finished another way
    const orphan = write("8.part", 900); // deleted title
    const legacy = write("33.part", 70); // pre-upgrade partial of file 33
    const fresh = write("99-abc.part", 5, 60_000); // too new to judge
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");

    expect(sweepPartials([root, path.join(tmp, "missing")])).toEqual({ files: 2, bytes: 910 });
    expect([keep, done, orphan, legacy, fresh].map((p) => fs.existsSync(p))).toEqual([true, false, false, true, true]);
    expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(true);
  });
});
