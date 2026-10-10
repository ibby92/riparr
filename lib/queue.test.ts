import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-queue-"));
process.env.RIPARR_CONFIG_DIR = tmp;

const { closeDb, run } = await import("./db");
const { addRootFolder } = await import("./root-folders");
const { createTitle, titleInput } = await import("./titles");
const hs = await import("./host-status");
const { RateLimitError } = await import("./errors");
const { hostStatuses, queueOverview } = await import("./queue");
const notifyMod = await import("./notify");

const NOW = Date.UTC(2026, 9, 10, 12);
const MIN = 60_000;
const HOUR = 60 * MIN;

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

let titleId = 0;
let nextLink = 1;

/** Inserts a link (and its files) straight into the database. */
function link(host: string, status: string, over: { retry_at?: number | null; error?: string; resolved?: boolean; files?: [string, number, number][] } = {}) {
  const id = nextLink++;
  run(
    `INSERT INTO links (id, title_id, url, fingerprint, host, status, error, retry_at, discovered_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, titleId, `https://${host}/${id}`, `fp${id}`, host, status, over.error ?? null, over.retry_at ?? null, id,
    over.resolved === false ? null : 1,
  );
  for (const [i, [st, done, size]] of (over.files ?? [["queued", 0, 100]]).entries()) {
    run(
      "INSERT INTO files (link_id, key, remote_name, status, bytes_done, size, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1)",
      id, `k${i}`, `f${id}-${i}.mkv`, st, done, size,
    );
  }
  return id;
}

beforeAll(() => {
  const root = addRootFolder(path.join(tmp, "media"));
  titleId = createTitle(titleInput.parse({ type: "show", name: "Q", root_folder_id: root, folder: "Q", season_folders: false, monitored: true }));
});

describe("host cooldowns", () => {
  it("names limits per host", () => {
    expect(hs.limitReason("pixeldrain", new RateLimitError("pixeldrain: You have reached your download limit", HOUR))).toBe("pixeldrain daily transfer limit");
    expect(hs.limitReason("mega", new RateLimitError("mega: Bandwidth limit reached", 30 * MIN))).toBe("MEGA transfer quota");
    expect(hs.limitReason("mega", new RateLimitError("mega: EOVERQUOTA (-17)", HOUR))).toBe("MEGA transfer quota");
    expect(hs.limitReason("gofile", new RateLimitError("gofile: rate limited", 10 * MIN))).toBe("gofile rate limit");
  });

  it("extends but never shortens a limit, keeps the episode start, holds pending links and ends on success after the reset", () => {
    const pending = link("mega", "new", { resolved: false });
    const later = link("mega", "queued", { retry_at: NOW + 5 * HOUR });
    expect(hs.recordHostLimit("mega", NOW + HOUR, "MEGA transfer quota", NOW)).toEqual({ until: NOW + HOUR, fresh: true });
    expect(hs.recordHostLimit("mega", NOW + 30 * MIN, "MEGA transfer quota", NOW + MIN)).toEqual({ until: NOW + HOUR, fresh: false });
    expect(hs.hostLimit("mega", NOW + MIN)).toEqual({ host: "mega", until: NOW + HOUR, reason: "MEGA transfer quota", since: NOW });

    const rows = (id: number) => queueOverview(NOW).waitingOnHost[0].items.find((i) => i.id === id)!;
    expect(rows(pending)).toMatchObject({ status: "queued", retry_at: NOW + HOUR, reason: "MEGA transfer quota" });
    expect(rows(later).retry_at).toBe(NOW + 5 * HOUR); // a longer backoff is kept

    // A success before the reset (a transfer that started earlier) doesn't end it; one after does.
    hs.recordHostOk("mega", NOW + 10 * MIN);
    expect(hs.hostLimit("mega", NOW + 10 * MIN)).not.toBeNull();
    hs.recordHostOk("mega", NOW + HOUR + 1);
    expect(hs.hostLimit("mega", NOW)).toBeNull();
    run("DELETE FROM links");
  });

  it("notifies once when a host stays limited for 6 hours, then again only in a new episode", () => {
    const spy = vi.spyOn(notifyMod, "notify");
    hs.recordHostLimit("pixeldrain", NOW + 4 * HOUR, "pixeldrain daily transfer limit", NOW);
    expect(hs.notifyLongLimits(NOW + 3 * HOUR)).toEqual([]);
    // Hit again at the reset: the same episode continues.
    hs.recordHostLimit("pixeldrain", NOW + 8 * HOUR, "pixeldrain daily transfer limit", NOW + 4 * HOUR);
    expect(hs.notifyLongLimits(NOW + 6 * HOUR)).toEqual(["pixeldrain"]);
    expect(hs.notifyLongLimits(NOW + 7 * HOUR)).toEqual([]);
    // Over long ago: a new limit starts a new episode.
    hs.recordHostLimit("pixeldrain", NOW + 20 * HOUR, "pixeldrain daily transfer limit", NOW + 12 * HOUR);
    expect(hs.hostLimit("pixeldrain", NOW + 12 * HOUR)?.since).toBe(NOW + 12 * HOUR);
    expect(hs.notifyLongLimits(NOW + 13 * HOUR)).toEqual([]);
    hs.clearHostLimit("pixeldrain");
    expect(hs.hostLimit("pixeldrain", NOW + 13 * HOUR)).toBeNull();
    spy.mockRestore();
  });

  it("clearing a limit releases the links it held", () => {
    const id = link("gofile", "queued");
    hs.recordHostLimit("gofile", NOW + HOUR, "gofile rate limit", NOW);
    hs.clearHostLimit("gofile");
    expect(queueOverview(NOW).queued.map((i) => [i.id, i.retry_at])).toEqual([[id, null]]);
    run("DELETE FROM links");
  });
});

describe("queueOverview", () => {
  it("files each pending link under why it is (or isn't) moving", () => {
    const slow = link("gofile", "downloading", { files: [["downloading", 10, 100]] });
    const fast = link("gofile", "downloading", { files: [["downloading", 90, 100]] });
    const resolving = link("mega", "resolving", { resolved: false, files: [] });
    hs.recordHostLimit("pixeldrain", NOW + 2 * HOUR, "pixeldrain daily transfer limit", NOW);
    hs.recordHostLimit("mega2", NOW + HOUR, "mega2 rate limit", NOW);
    const held = link("pixeldrain", "queued");
    const held2 = link("mega2", "new", { resolved: false, files: [] });
    hs.holdLimitedHosts(NOW);
    const late = link("gofile", "queued", { retry_at: NOW + 20 * MIN, error: "HTTP 500" });
    const soon = link("gofile", "queued", { retry_at: NOW + 5 * MIN, error: "Stalled: No data for 180s" });
    const ready = link("gofile", "queued");
    const unresolved = link("gofile", "new", { resolved: false, files: [] });
    const standby = link("gofile", "queued", { files: [["standby", 0, 100], ["done", 100, 100]] });
    link("gofile", "done");

    const q = queueOverview(NOW);
    const ids = (items: { id: number }[]) => items.map((i) => i.id);
    expect(ids(q.downloading)).toEqual([fast, slow, resolving]); // furthest along first
    expect(q.waitingOnHost.map((w) => [w.host, w.until, ids(w.items)])).toEqual([
      ["mega2", NOW + HOUR, [held2]],
      ["pixeldrain", NOW + 2 * HOUR, [held]],
    ]);
    expect(q.waitingOnHost[1].items[0]).toMatchObject({ reason: "pixeldrain daily transfer limit", next_attempt_at: NOW + 2 * HOUR, host_label: "pixeldrain" });
    expect(q.retrying.map((i) => [i.id, i.next_attempt_at, i.reason])).toEqual([
      [soon, NOW + 5 * MIN, "Stalled: No data for 180s"],
      [late, NOW + 20 * MIN, "HTTP 500"],
    ]);
    expect(ids(q.queued)).toEqual([ready, unresolved]);
    expect(ids(q.standby)).toEqual([standby]);
    expect(q.standby[0].files).toHaveLength(2);

    // Once the reset passes, held links are just queued again.
    expect(queueOverview(NOW + 3 * HOUR).waitingOnHost).toEqual([]);
  });

  it("hostStatuses lists every supported host, plus usage, limits, errors and active downloads", () => {
    hs.addHostUsage("gofile", 1000, NOW);
    hs.addHostUsage("gofile", 500, NOW);
    hs.addHostUsage("gofile", 7, NOW - 24 * HOUR); // yesterday
    run("UPDATE host_status SET last_ok_at = NULL WHERE host = 'mega'"); // from the cooldown tests
    hs.recordHostError("mega", "Stalled", NOW - 10 * MIN);
    const statuses = hostStatuses(NOW);
    expect(statuses.map((s) => [s.host, s.state, s.bytesToday, s.activeDownloads])).toEqual([
      ["gofile", "ok", 1500, 2],
      ["pixeldrain", "limited", 0, 0],
      ["mega", "errors", 0, 0],
      ["mega2", "limited", 0, 0],
    ]);
    expect(statuses[1]).toMatchObject({ until: NOW + 2 * HOUR, reason: "pixeldrain daily transfer limit", host_label: "pixeldrain" });
    expect(statuses[2]).toMatchObject({ reason: "Stalled", host_label: "MEGA" });
    // A later success, or an hour passing, clears "errors".
    expect(hostStatuses(NOW + HOUR).find((s) => s.host === "mega")?.state).toBe("ok");
    hs.recordHostOk("mega", NOW - 5 * MIN);
    expect(hostStatuses(NOW).find((s) => s.host === "mega")?.state).toBe("ok");
    expect(hs.usageByDay(2, NOW)).toEqual([
      { day: "2026-10-09", host: "gofile", bytes: 7 },
      { day: "2026-10-10", host: "gofile", bytes: 1500 },
    ]);
  });
});
