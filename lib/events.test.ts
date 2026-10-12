import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-events-"));
process.env.RIPARR_CONFIG_DIR = tmp;

const { all, closeDb, run } = await import("./db");
const ev = await import("./events");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});
afterEach(() => {
  delete process.env.RIPARR_LOG_LEVEL;
  ev.setDebugLogging(false);
  run("DELETE FROM events");
});

const rows = () => all<{ level: string; component: string | null; message: string }>("SELECT level, component, message FROM events ORDER BY id");

describe("logging", () => {
  it("drops debug entries unless debug logging is on, and keeps the other levels", () => {
    ev.logEvent("debug", "hidden", null, "check");
    ev.logDebug("check", () => {
      throw new Error("not built while debug is off");
    });
    ev.logEvent("info", "kept", null, "check");
    expect(rows()).toEqual([{ level: "info", component: "check", message: "kept" }]);

    ev.setDebugLogging(true);
    expect(ev.debugLogging()).toBe(true);
    ev.logDebug("download", () => "built lazily");
    expect(rows().at(-1)).toEqual({ level: "debug", component: "download", message: "built lazily" });
  });

  it("can be forced on with RIPARR_LOG_LEVEL=debug", () => {
    process.env.RIPARR_LOG_LEVEL = "debug";
    expect(ev.debugLogging()).toBe(true);
    expect(ev.debugForcedByEnv()).toBe(true);
    ev.logDebug("worker", "from env");
    expect(rows()).toHaveLength(1);
  });

  it("throttles repeated failures per key", () => {
    expect(ev.logThrottled("tick", 600_000, "error", "boom", null, "worker", 1_000)).toBe(true);
    expect(ev.logThrottled("tick", 600_000, "error", "boom", null, "worker", 2_000)).toBe(false);
    expect(ev.logThrottled("other", 600_000, "error", "boom", null, "worker", 2_000)).toBe(true);
    expect(ev.logThrottled("tick", 600_000, "error", "boom", null, "worker", 700_000)).toBe(true);
    expect(rows()).toHaveLength(3);
  });

  it("keeps debug entries out of the activity feed and prunes them sooner", () => {
    ev.setDebugLogging(true);
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const insert = (level: string, ageDays: number, activity: string | null = null) =>
      run("INSERT INTO events (at, level, message, activity) VALUES (?, ?, ?, ?)", now - ageDays * day, level, `${level} ${ageDays}d`, activity);
    insert("debug", 1);
    insert("debug", 4);
    insert("info", 4, "downloaded");
    insert("error", 31, "download_failed");
    insert("info", 2); // plain log entry: not activity
    expect(ev.recentEvents(10).map((e) => e.message)).toEqual(["error 31d", "info 4d"]);
    ev.pruneEvents(30 * day, 3 * day, now);
    expect(rows().map((r) => r.message)).toEqual(["debug 1d", "info 4d", "info 2d"]);
  });
});
