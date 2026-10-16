import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-filedelete-"));
process.env.RIPARR_CONFIG_DIR = path.join(tmp, "config");
const media = path.join(tmp, "media");
fs.mkdirSync(media, { recursive: true });

const { all, closeDb, one, run } = await import("./db");
const { addRootFolder } = await import("./root-folders");
const { createTitle, titleInput } = await import("./titles");
const { scanTitle, syncFolder } = await import("./disk-scan");
const { deleteTitleFile, restoreEpisode } = await import("./file-delete");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const rootId = addRootFolder(media);
const id = createTitle(titleInput.parse({ type: "show", name: "Del", root_folder_id: rootId, folder: "Del", season_folders: false, naming: "{filename}", monitored: true }));
const file = (n: number) => path.join(media, "Del", `Del.S01E0${n}.mkv`);

fs.mkdirSync(path.join(media, "Del"), { recursive: true });
fs.writeFileSync(path.join(media, "Outside.mkv"), "x");
run("INSERT INTO links (id, title_id, url, fingerprint, host, status, discovered_at) VALUES (1, ?, 'u', 'fp1', 'gofile', 'done', 1)", id);
for (const n of [1, 2, 3]) {
  fs.writeFileSync(file(n), "x");
  run("INSERT INTO files (link_id, key, remote_name, status, local_path, season, episode, updated_at) VALUES (1, ?, ?, 'done', ?, 1, ?, 1)", `k${n}`, `Del.S01E0${n}.mkv`, file(n), n);
}
scanTitle(id);
const statusOf = (key: string) =>
  one<{ status: string; local_path: string | null; removed_at: number | null }>("SELECT status, local_path, removed_at FROM files WHERE key = ?", key)!;

describe("deleteTitleFile", () => {
  it("refuses paths outside the title folder and files Riparr doesn't know", () => {
    expect(deleteTitleFile(id, path.join(media, "Outside.mkv"), false)).toMatchObject({ ok: false });
    expect(deleteTitleFile(id, path.join(media, "Del", "../Outside.mkv"), false)).toMatchObject({ ok: false });
    fs.writeFileSync(path.join(media, "Del", "unknown.mkv"), "x");
    expect(deleteTitleFile(id, path.join(media, "Del", "unknown.mkv"), false)).toMatchObject({ ok: false });
    expect(fs.existsSync(path.join(media, "Outside.mkv"))).toBe(true);
    expect(fs.existsSync(path.join(media, "Del", "unknown.mkv"))).toBe(true);
  });

  it("deletes and keeps the episode, on any host, from being fetched again", () => {
    // Another host lists E01 too, on standby.
    run("INSERT INTO links (id, title_id, url, fingerprint, host, status, discovered_at) VALUES (2, ?, 'u2', 'fp2', 'pixeldrain', 'mirror', 1)", id);
    run("INSERT INTO files (link_id, key, remote_name, status, season, episode, updated_at) VALUES (2, 'p1', 'Del.S01E01.other.mkv', 'standby', 1, 1, 1)");

    expect(deleteTitleFile(id, file(1), false, 1000)).toEqual({
      ok: true,
      file: { name: "Del.S01E01.mkv", season: 1, episode: 1, size: 1 },
      requeued: 0,
    });
    expect(fs.existsSync(file(1))).toBe(false);
    expect(statusOf("k1")).toEqual({ status: "skipped", local_path: null, removed_at: 1000 });
    expect(statusOf("p1")).toEqual({ status: "skipped", local_path: null, removed_at: 1000 });
    expect(all("SELECT path FROM disk_files WHERE path = ?", file(1))).toEqual([]);
    syncFolder(id);
    expect(statusOf("k1").status).toBe("skipped");
  });

  it("asks to download a deleted episode again", () => {
    expect(restoreEpisode(id, 1, 1)).toBe(2);
    expect(statusOf("k1")).toEqual({ status: "standby", local_path: null, removed_at: null });
    expect(statusOf("p1")).toEqual({ status: "standby", local_path: null, removed_at: null });
    expect(one<{ status: string }>("SELECT status FROM links WHERE id = 2")!.status).toBe("queued");
    expect(restoreEpisode(id, 1, 1)).toBe(0);
  });

  it("deletes and queues the episode again, giving its failed and offline links another chance", () => {
    // gofile failed before listing its files (E02 known only from the source's details); E03's gofile link went offline.
    run("INSERT INTO links (id, title_id, url, fingerprint, host, status, episode, attempts, error, discovered_at) VALUES (5, ?, 'g2', 'fpg2', 'gofile', 'failed', 'S01E02', 5, 'gofile: error-wrongToken', 1)", id);
    run("INSERT INTO links (id, title_id, url, fingerprint, host, status, resolved_at, discovered_at) VALUES (6, ?, 'g3', 'fpg3', 'gofile', 'offline', 1, 1)", id);
    run("INSERT INTO files (link_id, key, remote_name, status, season, episode, updated_at) VALUES (6, 'g3', 'Del.S01E03.mkv', 'failed', 1, 3, 1)");

    expect(deleteTitleFile(id, file(2), true)).toMatchObject({ ok: true, file: { name: "Del.S01E02.mkv", episode: 2 }, requeued: 1 });
    expect(fs.existsSync(file(2))).toBe(false);
    expect(statusOf("k2")).toEqual({ status: "standby", local_path: null, removed_at: null });
    expect(one<{ status: string }>("SELECT status FROM links WHERE id = 1")!.status).toBe("queued");
    expect(statusOf("k3").status).toBe("done");
    // Resolved again before mirror selection picks a copy; other episodes' dead links are left alone.
    const link = (lid: number) => one<{ status: string; resolved_at: number | null; attempts: number }>("SELECT status, resolved_at, attempts FROM links WHERE id = ?", lid)!;
    expect(link(5)).toEqual({ status: "new", resolved_at: null, attempts: 0 });
    expect(link(6).status).toBe("offline");
    expect(statusOf("g3").status).toBe("failed");
  });

  it("deletes a file Riparr didn't download, and queues the copies it made unnecessary", () => {
    const own = path.join(media, "Del", "My.S01E04.mkv");
    fs.writeFileSync(own, "x");
    run("INSERT INTO files (link_id, key, remote_name, status, local_path, season, episode, updated_at) VALUES (1, 'k4', 'Del.S01E04.mkv', 'skipped', ?, 1, 4, 1)", own);
    scanTitle(id);
    expect(deleteTitleFile(id, own, true)).toMatchObject({ ok: true, requeued: 1 });
    expect(statusOf("k4")).toEqual({ status: "standby", local_path: null, removed_at: null });
  });
});
