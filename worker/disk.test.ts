import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-disk-"));
process.env.RIPARR_CONFIG_DIR = path.join(tmp, "config");
const root = path.join(tmp, "media");
fs.mkdirSync(root);

const { closeDb } = await import("@/lib/db");
const { recentEvents } = await import("@/lib/events");
const { readDiskStatus, saveSettings } = await import("@/lib/settings");
const { diskIsLow, resetDiskCheck } = await import("./disk");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("diskIsLow", () => {
  it("is off at 0 and publishes each root folder's space", () => {
    saveSettings({ minFreeGb: 0 });
    resetDiskCheck();
    expect(diskIsLow(root, 1)).toBe(false);
    const status = readDiskStatus()!;
    expect(status.low).toBe(false);
    expect(status.roots).toHaveLength(1);
    expect(status.roots[0]).toMatchObject({ path: root, low: false });
    expect(status.roots[0].freeBytes).toBeGreaterThan(0);
    expect(status.roots[0].totalBytes!).toBeGreaterThanOrEqual(status.roots[0].freeBytes!);
  });

  it("goes low above the volume's free space, caches for 30s per root, and logs once per episode", () => {
    saveSettings({ minFreeGb: 1e9 });
    expect(diskIsLow(root, 2)).toBe(false); // still cached from the check at t=1
    expect(diskIsLow(root, 40_000)).toBe(true);
    expect(diskIsLow(root, 80_000)).toBe(true);
    expect(readDiskStatus()!.low).toBe(true);
    expect(recentEvents(10).filter((e) => e.message.includes("new downloads there are paused"))).toHaveLength(1);

    saveSettings({ minFreeGb: 0 });
    expect(diskIsLow(root, 120_000)).toBe(false);
    expect(recentEvents(1)[0].message).toBe(`Free space recovered in ${root}; downloads resumed`);
  });

  it("treats an unreadable root as not low (the download itself will report the problem)", () => {
    saveSettings({ minFreeGb: 5 });
    expect(diskIsLow(path.join(tmp, "missing"), 200_000)).toBe(false);
  });
});
