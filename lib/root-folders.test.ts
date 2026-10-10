import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-roots-"));
process.env.RIPARR_CONFIG_DIR = path.join(tmp, "config");
const videos = path.join(tmp, "Videos");
for (const d of ["KDrama", "CDrama", "Movies"]) fs.mkdirSync(path.join(videos, d), { recursive: true });

const { closeDb } = await import("./db");
const { addRootFolder, diskTotals, listDirectories, listRootFolders, normalizeRootPath, rootFolderError } = await import("./root-folders");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("root folders", () => {
  it("normalizes absolute paths and leaves relative ones to be refused", () => {
    expect(normalizeRootPath(" /media/TV/ ")).toBe("/media/TV");
    expect(normalizeRootPath("/media/x/../TV")).toBe("/media/TV");
    expect(normalizeRootPath("/")).toBe("/");
    expect(normalizeRootPath("../../")).toBe("../../");
    expect(rootFolderError(normalizeRootPath("Videos"))).toMatch(/absolute path/);
    expect(() => listDirectories("../../")).toThrow(/absolute path/);
  });

  it("refuses a root folder inside or around another one, and flags existing overlaps", () => {
    addRootFolder(path.join(videos, "KDrama"));
    expect(rootFolderError(path.join(videos, "CDrama"))).toBeNull();
    expect(rootFolderError(videos)).toMatch(/contains the root folder .*KDrama/);
    expect(rootFolderError(path.join(videos, "KDrama", "Sub"))).toMatch(/doesn't exist|inside the root folder/);
    fs.mkdirSync(path.join(videos, "KDrama", "Sub"));
    expect(rootFolderError(path.join(videos, "KDrama", "Sub"))).toMatch(/inside the root folder .*KDrama/);
    // Re-adding the same path is fine (it's the same root).
    expect(rootFolderError(path.join(videos, "KDrama"))).toBeNull();

    // Overlaps that exist already (e.g. from before this check) are reported.
    addRootFolder(videos);
    addRootFolder(path.join(videos, "Movies"));
    const byPath = Object.fromEntries(listRootFolders().map((r) => [path.basename(r.path), r.overlaps]));
    expect(byPath.Videos).not.toBeNull();
    expect(byPath.KDrama).toBe(videos);
  });

  it("counts each disk once in the totals", () => {
    const roots = listRootFolders();
    expect(roots.length).toBe(3);
    const totals = diskTotals(roots)!;
    expect(totals.disks).toBe(1);
    expect(totals.total).toBe(roots[0].total_bytes);
    expect(diskTotals([])).toBeNull();
  });
});
