import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-schedule-"));
process.env.RIPARR_CONFIG_DIR = tmp;

const { all, closeDb, run } = await import("./db");
const { addRootFolder } = await import("./root-folders");
const { createTitle, getTitle, setTitleArchived, titleInput } = await import("./titles");
const { scheduleBetween, staleSchedules, syncSchedule } = await import("./schedule");
import type { TmdbClient } from "./tmdb";

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const fakeClient = {
  async show() {
    return {
      seasons: [
        { season: 0, name: "Specials", episodeCount: 1, special: true },
        { season: 1, name: "Season 1", episodeCount: 6 },
      ],
    };
  },
  async season(_id: number, season: number) {
    if (season === 0) throw new Error("specials shouldn't be read");
    return [1, 2, 3, 4, 5, 6].map((n) => ({ episode: n, title: n === 1 ? "Pilot" : `Episode ${n}`, airDate: n <= 5 ? `2026-10-0${n + 4}` : null }));
  },
  async movie() {
    return { releaseDate: "2026-10-15" };
  },
} as unknown as TmdbClient;

describe("schedule", () => {
  const rootId = addRootFolder(tmp);
  const add = (type: "show" | "movie", name: string) =>
    createTitle(titleInput.parse({ type, name, tmdb_id: 100 + name.length, root_folder_id: rootId, folder: name, naming: "{filename}", monitored: true }));

  it("reads a show's episodes from TMDB, without specials, and keeps its episode count current", async () => {
    const id = add("show", "Between Steps");
    expect(staleSchedules(1000, 10)).toContain(id);
    await syncSchedule(id, fakeClient, 5_000);
    expect(all("SELECT season, episode, name, air_date FROM episodes WHERE title_id = ? ORDER BY episode", id)).toHaveLength(6);
    expect(getTitle(id)).toMatchObject({ total_episodes: 6, schedule_synced_at: 5_000 });
    expect(staleSchedules(1000, 10, 5_500)).not.toContain(id);
  });

  it("marks each dated episode downloaded, on its way, missing, airing today or upcoming", async () => {
    const id = all<{ id: number }>("SELECT id FROM titles WHERE name = 'Between Steps'")[0].id;
    run("INSERT INTO links (id, title_id, url, fingerprint, host, status, discovered_at) VALUES (1, ?, 'u1', 'f1', 'gofile', 'done', 1)", id);
    run("INSERT INTO links (id, title_id, url, fingerprint, host, status, discovered_at) VALUES (2, ?, 'u2', 'f2', 'pixeldrain', 'queued', 1)", id);
    run("INSERT INTO files (link_id, key, remote_name, status, season, episode, updated_at) VALUES (1, 'a', 'E1', 'done', 1, 1, 1)");
    run("INSERT INTO files (link_id, key, remote_name, status, season, episode, updated_at) VALUES (2, 'c', 'E3', 'downloading', 1, 3, 1)");
    run("INSERT INTO files (link_id, key, remote_name, status, season, episode, updated_at) VALUES (2, 'd', 'E4', 'queued', 1, 4, 1)");
    run("INSERT INTO disk_files (title_id, path, size, season, episode, mtime) VALUES (?, '/m/E2.mkv', 1, 1, 2, 1)", id);

    // Episodes air 5–9 Oct; it's the 8th.
    const items = scheduleBetween("2026-10-01", "2026-10-31", "2026-10-08").filter((i) => i.title_id === id);
    expect(items.map((i) => [i.episode, i.date, i.state])).toEqual([
      [1, "2026-10-05", "downloaded"],
      [2, "2026-10-06", "downloaded"],
      [3, "2026-10-07", "downloading"],
      [4, "2026-10-08", "queued"],
      [5, "2026-10-09", "upcoming"],
    ]);
    expect(items[0]).toMatchObject({ title_name: "Between Steps", title_type: "show", season: 1, name: "Pilot", monitored: true });
    expect(items[1].name).toBeNull(); // TMDB's "Episode 2" placeholder adds nothing
    expect(scheduleBetween("2026-10-09", "2026-10-09", "2026-10-09").find((i) => i.title_id === id)?.state).toBe("today");
    expect(scheduleBetween("2026-10-09", "2026-10-09", "2026-10-12").find((i) => i.title_id === id)?.state).toBe("missing");

    setTitleArchived(id, true);
    expect(scheduleBetween("2026-10-01", "2026-10-31", "2026-10-08").filter((i) => i.title_id === id)).toEqual([]);
  });

  it("puts a movie on its release date", async () => {
    const id = add("movie", "Parasite");
    await syncSchedule(id, fakeClient);
    expect(getTitle(id)?.release_date).toBe("2026-10-15");
    expect(scheduleBetween("2026-10-15", "2026-10-15", "2026-10-01").map((i) => [i.title_name, i.state])).toEqual([["Parasite", "upcoming"]]);
  });
});
