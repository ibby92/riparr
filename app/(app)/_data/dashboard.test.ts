import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-dashboard-"));
process.env.RIPARR_CONFIG_DIR = tmp;

const { closeDb, run } = await import("@/lib/db");
const { addHostUsage, localDay, localDayBefore } = await import("@/lib/host-status");
const { addRootFolder } = await import("@/lib/root-folders");
const { createTitle, titleInput } = await import("@/lib/titles");
const { downloadsByDay, weekStats } = await import("./dashboard");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("dashboard data", () => {
  it("charts and totals what was transferred per host, the same figures the sidebar shows", () => {
    const now = new Date(2026, 9, 10, 20, 0).getTime(); // local time
    addHostUsage("gofile", 4_000, now);
    addHostUsage("pixeldrain", 5_000, now);
    addHostUsage("gofile", 1_000, new Date(2026, 9, 9, 23, 30).getTime());
    run("INSERT INTO host_usage (host, day, bytes) VALUES ('mega', ?, 700)", localDayBefore(now, 8));

    const chart = downloadsByDay(now, 14);
    expect(chart.days).toHaveLength(14);
    expect(chart.days.at(-1)).toMatchObject({ key: localDay(now), label: "Today", total: 9_000, byHost: { gofile: 4_000, pixeldrain: 5_000 } });
    expect(chart.days.at(-2)).toMatchObject({ label: "9 Oct", total: 1_000 });
    expect(chart.hosts).toEqual(["gofile", "pixeldrain", "mega"]);

    const week = weekStats(now);
    expect(week.current.bytes).toBe(10_000);
    expect(week.previous.bytes).toBe(700);
  });

  it("lists the files that finished each day as arrivals", () => {
    const now = new Date(2026, 9, 10, 20, 0).getTime();
    const rootId = addRootFolder(tmp);
    const id = createTitle(titleInput.parse({ type: "show", name: "Doctor X", root_folder_id: rootId, folder: "Doctor X", naming: "{filename}", monitored: true }));
    run("INSERT INTO links (id, title_id, url, fingerprint, host, status, discovered_at) VALUES (1, ?, 'u', 'f', 'gofile', 'done', 1)", id);
    const file = (fid: number, ep: number, status: string, at: number) =>
      run("INSERT INTO files (id, link_id, key, remote_name, size, status, season, episode, updated_at) VALUES (?, 1, ?, ?, 100, ?, 1, ?, ?)", fid, `k${fid}`, `DrX.S01E0${ep}.mkv`, status, ep, at);
    file(1, 1, "done", new Date(2026, 9, 9, 22, 0).getTime());
    file(2, 2, "done", new Date(2026, 9, 10, 9, 0).getTime());
    file(3, 3, "skipped", new Date(2026, 9, 10, 9, 0).getTime()); // already in the folder: not an arrival
    file(4, 4, "done", new Date(2026, 8, 20, 9, 0).getTime()); // outside the window

    const days = downloadsByDay(now, 14).days;
    expect(days.at(-1)!.arrivals.map((a) => [a.title_name, a.episode, a.host])).toEqual([["Doctor X", 2, "gofile"]]);
    expect(days.at(-2)!.arrivals.map((a) => a.episode)).toEqual([1]);
    expect(days.flatMap((d) => d.arrivals)).toHaveLength(2);
    // The week's episode count matches the strip: skipped files weren't downloaded.
    expect(weekStats(now).current.episodes).toBe(2);
  });
});
