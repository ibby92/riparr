import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-diskscan-"));
process.env.RIPARR_CONFIG_DIR = path.join(tmp, "config");
const media = path.join(tmp, "media");
fs.mkdirSync(media, { recursive: true });

const { closeDb, run } = await import("./db");
const { addRootFolder } = await import("./root-folders");
const { createTitle, getTitle, titleInput } = await import("./titles");
const { diskEpisode, externalDiskFiles, scanTitle, staleScans } = await import("./disk-scan");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const rootId = addRootFolder(media);
const title = (type: "show" | "movie", folder: string) =>
  createTitle(titleInput.parse({ type, name: folder, root_folder_id: rootId, folder, season_folders: true, naming: "{filename}", monitored: true }));
const put = (rel: string, bytes = 10) => {
  fs.mkdirSync(path.dirname(path.join(media, rel)), { recursive: true });
  fs.writeFileSync(path.join(media, rel), "x".repeat(bytes));
};

describe("diskEpisode", () => {
  it("reads the episode from the name, and a bare episode's season from its Season folder", () => {
    expect(diskEpisode("/m/Show/Show.S02E03.mkv", "show")).toEqual({ season: 2, episode: 3 });
    expect(diskEpisode("/m/Show/Season 02/Show EP05.mkv", "show")).toEqual({ season: 2, episode: 5 });
    expect(diskEpisode("/m/Show/Show EP05.mkv", "show")).toEqual({ season: 1, episode: 5 });
    expect(diskEpisode("/m/Show/Season 03/Show.S01E01.mkv", "show")).toEqual({ season: 1, episode: 1 });
    expect(diskEpisode("/m/Show/trailer.mkv", "show")).toEqual({ season: null, episode: null });
    expect(diskEpisode("/m/Movie (2019)/Movie.S01E01.mkv", "movie")).toEqual({ season: null, episode: null });
  });
});

describe("scanTitle", () => {
  it("finds video files in the title folder, skipping hidden folders and non-video files", () => {
    const id = title("show", "Between Steps (2026)");
    put("Between Steps (2026)/Between.Steps.S01E01.DSNP.x264.1080p[MkvDrama.net].mkv", 30);
    put("Between Steps (2026)/Season 01/Between Steps EP02.mp4", 20);
    put("Between Steps (2026)/Between.Steps.S01E01.en.srt");
    put("Between Steps (2026)/.riparr-partial/7.part");
    put("Between Steps (2026)/.hidden/Between.Steps.S01E03.mkv");
    put("Other Show/Other.S01E01.mkv");

    const found = scanTitle(id, 1000)!;
    expect(found.map((f) => [path.relative(media, f.path), f.season, f.episode, f.size]).sort()).toEqual([
      ["Between Steps (2026)/Between.Steps.S01E01.DSNP.x264.1080p[MkvDrama.net].mkv", 1, 1, 30],
      ["Between Steps (2026)/Season 01/Between Steps EP02.mp4", 1, 2, 20],
    ]);
    expect(getTitle(id)!.disk_scanned_at).toBe(1000);
    expect(externalDiskFiles(id)).toHaveLength(2);

    // A rescan replaces the rows: a removed file disappears.
    fs.rmSync(path.join(media, "Between Steps (2026)/Season 01/Between Steps EP02.mp4"));
    expect(scanTitle(id, 2000)).toHaveLength(1);
    expect(externalDiskFiles(id)).toHaveLength(1);
  });

  it("leaves Riparr's own downloads out of the external files", () => {
    const id = title("show", "Own Downloads");
    put("Own Downloads/Own.S01E01.mkv");
    put("Own Downloads/Own.S01E02.mkv");
    run("INSERT INTO links (id, title_id, url, fingerprint, host, status, discovered_at) VALUES (900, ?, 'u', 'fp900', 'gofile', 'done', 1)", id);
    run(
      "INSERT INTO files (link_id, key, remote_name, status, local_path, updated_at) VALUES (900, 'k', 'Own.S01E02.mkv', 'done', ?, 1)",
      path.join(media, "Own Downloads/Own.S01E02.mkv"),
    );
    scanTitle(id);
    expect(externalDiskFiles(id).map((f) => path.basename(f.path))).toEqual(["Own.S01E01.mkv"]);
  });

  it("keeps the last results when the root folder is unreachable, and clears them when only the title folder is gone", () => {
    const id = title("show", "Gone Show");
    put("Gone Show/Gone.S01E01.mkv");
    scanTitle(id);
    expect(externalDiskFiles(id)).toHaveLength(1);

    const moved = `${media}-unmounted`;
    fs.renameSync(media, moved);
    try {
      expect(scanTitle(id)).toBeNull();
      expect(externalDiskFiles(id)).toHaveLength(1);
    } finally {
      fs.renameSync(moved, media);
    }

    fs.rmSync(path.join(media, "Gone Show"), { recursive: true });
    expect(scanTitle(id)).toEqual([]);
    expect(externalDiskFiles(id)).toHaveLength(0);
  });

  it("lists titles due for a rescan, never-scanned first", () => {
    run("UPDATE titles SET disk_scanned_at = 5000");
    const fresh = title("movie", "Fresh Movie");
    expect(staleScans(1000, 10, 5500)).toEqual([fresh]);
    expect(staleScans(1000, 10, 7000)[0]).toBe(fresh);
  });
});
