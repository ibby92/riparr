import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { FileView } from "./progress";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-progress-"));
process.env.RIPARR_CONFIG_DIR = tmp;

const { closeDb, run } = await import("@/lib/db");
const { addRootFolder } = await import("@/lib/root-folders");
const { createTitle, getTitle, titleInput } = await import("@/lib/titles");
const { episodeRows, summarize, unsupportedLinks } = await import("./progress");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const view = (episode: number, state: FileView["state"], host = "gofile"): FileView =>
  ({ file_id: episode * 10, link_id: episode, title_id: 1, season: 1, episode, name: `S.S01E0${episode}.mkv`, dir: "", size: 100, bytes_done: 0, speed_bps: 0,
     status: state === "done" ? "done" : "queued", local_path: null, error: null, updated_at: 1, host, link_status: "queued", link_error: null, retry_at: null,
     state, until: null, reason: null }) as FileView;
const disk = (episode: number | null, p = `/m/S/mine ${episode}.mkv`) => ({ title_id: 1, path: p, size: 50, season: 1, episode, mtime: 1 });

describe("episodeRows", () => {
  it("counts an episode already in the folder as done, and says which unsupported hosts list a missing one", () => {
    // Between Steps: E01 only on unsupported hosts but already on disk; E02 downloaded; E03 only on unsupported hosts.
    const rows = episodeRows({ total_episodes: 4 }, [view(2, "done")], {
      disk: [disk(1)],
      unsupported: [
        { season: 1, episode: 1, host: "send.now" },
        { season: 1, episode: 3, host: "vikingfile.com" },
        { season: 1, episode: 3, host: "send.now" },
      ],
    });
    expect(rows.map((r) => [r.episode, r.state, r.disk?.path ?? null, r.unsupported])).toEqual([
      [1, "done", "/m/S/mine 1.mkv", ["send.now"]],
      [2, "done", null, []],
      [3, "missing", null, ["send.now", "vikingfile.com"]],
      [4, "missing", null, []],
    ]);
  });

  it("prefers Riparr's finished copy over the folder file, and the folder file over a pending copy", () => {
    const rows = episodeRows({ total_episodes: null }, [view(1, "done"), view(2, "queued")], { disk: [disk(1), disk(2)], unsupported: [] });
    expect(rows.map((r) => [r.episode, r.state, r.file?.file_id ?? null, r.disk?.episode ?? null])).toEqual([
      [1, "done", 10, null],
      [2, "done", null, 2],
    ]);
  });
});

describe("summarize", () => {
  const rootId = addRootFolder(tmp);
  const make = (type: "show" | "movie", total: number | null) => {
    const id = createTitle(titleInput.parse({ type, name: `T${type}`, root_folder_id: rootId, folder: `T${type}`, naming: "{filename}", monitored: true }));
    run("UPDATE titles SET total_episodes = ? WHERE id = ?", total, id);
    return getTitle(id)!;
  };

  it("counts folder episodes towards a show's progress", () => {
    const p = summarize(make("show", 3), [view(2, "done")], { disk: [disk(1)], unsupported: [] });
    expect(p).toMatchObject({ total: 3, done: 2 });
  });

  it("marks a movie done when its folder already has a video", () => {
    const movie = make("movie", null);
    expect(summarize(movie, [], { disk: [disk(null, "/m/Movie/Movie.mkv")], unsupported: [] })).toMatchObject({ movieState: "done", done: 1, movieFraction: 1 });
    expect(summarize(movie, [], { disk: [], unsupported: [] })).toMatchObject({ movieState: "missing", done: 0 });
  });
});

describe("unsupportedLinks", () => {
  it("lists ignored links on hosts Riparr can't download from, with their episode", () => {
    const rootId = addRootFolder(path.join(tmp, "u"));
    const id = createTitle(titleInput.parse({ type: "show", name: "U", root_folder_id: rootId, folder: "U", naming: "{filename}", monitored: true }));
    const link = (n: number, host: string, status: string, episode: string | null, label: string | null, url = `https://${host}/${n}`) =>
      run("INSERT INTO links (title_id, url, fingerprint, host, status, episode, label, discovered_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1)", id, url, `fp${n}`, host, status, episode, label);
    link(1, "send.now", "ignored", "S01E01", null);
    link(2, "vikingfile.com", "ignored", null, "Show.S01E02.mkv");
    link(3, "fileditchfiles.st", "ignored", null, null, "https://fileditchfiles.st/x/Show.S01E03%5Btag%5D.mkv");
    link(4, "gofile", "ignored", "S01E04", null); // ignored by the user, not unsupported
    link(5, "filekeeper.net", "ignored", null, null); // no episode known
    link(6, "send.now", "queued", "S01E06", null);
    expect(unsupportedLinks(id)).toEqual([
      { season: 1, episode: 1, host: "send.now" },
      { season: 1, episode: 2, host: "vikingfile.com" },
      { season: 1, episode: 3, host: "fileditchfiles.st" },
    ]);
  });
});
