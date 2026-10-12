import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-logs-"));
process.env.RIPARR_CONFIG_DIR = tmp;

const { closeDb, run } = await import("@/lib/db");
const { logEntries, logStats } = await import("./logs");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("logEntries", () => {
  it("filters by minimum level, area and text (with LIKE wildcards taken literally)", () => {
    const add = (level: string, component: string | null, message: string) =>
      run("INSERT INTO events (at, level, component, message) VALUES (?, ?, ?, ?)", Date.now(), level, component, message);
    add("debug", "check", "GET https://mkvdrama.net/c/x → HTTP 410");
    add("info", "check", "Found 4 new link(s) via crate-api");
    add("warn", "download", "Attempt 1/5 failed: 100% done?");
    add("error", "download", "Failed: https://gofile.io/d/x");

    const msgs = (f: Parameters<typeof logEntries>[0]) => logEntries(f).entries.map((e) => e.message);
    expect(msgs({ minLevel: "debug" })).toHaveLength(4);
    expect(msgs({ minLevel: "info" })).toHaveLength(3);
    expect(msgs({ minLevel: "warn" })).toEqual(["Failed: https://gofile.io/d/x", "Attempt 1/5 failed: 100% done?"]);
    expect(msgs({ minLevel: "debug", component: "check" })).toHaveLength(2);
    expect(msgs({ minLevel: "debug", text: "http 410" })).toEqual(["GET https://mkvdrama.net/c/x → HTTP 410"]);
    expect(msgs({ minLevel: "debug", text: "100%" })).toEqual(["Attempt 1/5 failed: 100% done?"]);
    expect(msgs({ minLevel: "debug", text: "%" })).toEqual(["Attempt 1/5 failed: 100% done?"]);

    const page = logEntries({ minLevel: "debug" }, 2);
    expect(page.hasMore).toBe(true);
    expect(logEntries({ minLevel: "debug", before: page.entries[1].id }, 2).entries).toHaveLength(2);
    expect(logStats().counts).toEqual({ debug: 1, info: 1, warn: 1, error: 1 });
  });
});
