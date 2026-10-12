import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-time-"));
process.env.RIPARR_CONFIG_DIR = tmp;

const { closeDb } = await import("./db");
const { saveSettings } = await import("./settings");
const t = await import("./time");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const at = Date.UTC(2026, 9, 12, 3, 30); // 03:30 UTC on Monday 12 Oct

describe("time zone", () => {
  it("falls back to the container's zone, and follows the setting once chosen", () => {
    expect(t.chosenTimeZone()).toBe("");
    expect(t.timeZone()).toBe(t.serverTimeZone());

    saveSettings({ timeZone: "America/Toronto" });
    t.resetTimeZoneCache();
    expect(t.timeZone()).toBe("America/Toronto");
    expect(process.env.TZ).toBe("America/Toronto");
    // 03:30 UTC is 23:30 the evening before in Toronto.
    expect(t.clockTime(at)).toBe("23:30");
    expect(t.localDay(at)).toBe("2026-10-11");
    expect(t.localDayBefore(at, 1)).toBe("2026-10-10");
    expect(new Date(t.startOfDay(at)).toISOString()).toBe("2026-10-11T04:00:00.000Z");
    expect(t.dayLabel(at, at)).toBe("Today");
    expect(t.dayLabel(at - 24 * 3600_000, at)).toBe("Yesterday");
    expect(t.dayLabel(at - 3 * 24 * 3600_000, at, "long")).toBe("Thursday 8 October");

    saveSettings({ timeZone: "Asia/Seoul" });
    t.resetTimeZoneCache();
    expect(t.clockTime(at)).toBe("12:30");
    expect(t.localDay(at)).toBe("2026-10-12");
  });

  it("knows valid zone names", () => {
    expect(t.isTimeZone("Europe/London")).toBe(true);
    expect(t.isTimeZone("UTC")).toBe(true);
    expect(t.isTimeZone("Mars/Olympus")).toBe(false);
    expect(t.isTimeZone("")).toBe(false);
    expect(t.timeZones()).toContain("America/Toronto");
  });

  it("ignores a stored zone this runtime doesn't know", () => {
    saveSettings({ timeZone: "Not/AZone" });
    t.resetTimeZoneCache();
    expect(t.chosenTimeZone()).toBe("");
    expect(t.timeZone()).toBe(t.serverTimeZone());
  });
});
