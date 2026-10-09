import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-disk-"));
process.env.RIPARR_CONFIG_DIR = path.join(tmp, "config");
process.env.RIPARR_DOWNLOADS_DIR = path.join(tmp, "downloads");

const { closeDb } = await import("@/lib/db");
const { recentEvents } = await import("@/lib/events");
const { readDiskStatus, saveSettings } = await import("@/lib/settings");
const { diskIsLow, resetDiskCheck } = await import("./disk");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("diskIsLow", () => {
  it("is off at 0 and records free space", () => {
    saveSettings({ minFreeGb: 0 });
    resetDiskCheck();
    expect(diskIsLow(1)).toBe(false);
    const status = readDiskStatus()!;
    expect(status.freeBytes).toBeGreaterThan(0);
    expect(status.totalBytes).toBeGreaterThanOrEqual(status.freeBytes);
  });

  it("goes low above the volume's free space, caches for 30s, and logs once per episode", () => {
    saveSettings({ minFreeGb: 1e9 });
    expect(diskIsLow(2)).toBe(false); // still cached from the check at t=1
    expect(diskIsLow(40_000)).toBe(true);
    expect(diskIsLow(80_000)).toBe(true);
    expect(recentEvents(10).filter((e) => e.message.includes("downloads are paused"))).toHaveLength(1);

    saveSettings({ minFreeGb: 0 });
    expect(diskIsLow(120_000)).toBe(false);
    expect(recentEvents(1)[0].message).toBe("Free space recovered; downloads resumed");
  });
});
