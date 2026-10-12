import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-history-"));
process.env.RIPARR_CONFIG_DIR = tmp;

const { closeDb } = await import("@/lib/db");
const { logEvent } = await import("@/lib/events");
const { addRootFolder } = await import("@/lib/root-folders");
const { createTitle, titleInput } = await import("@/lib/titles");
const { historyEvents, historySummary, historyTitles } = await import("./history");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("history", () => {
  it("shows activity only, filters by category, and sums the period", () => {
    const rootId = addRootFolder(tmp);
    const show = createTitle(titleInput.parse({ type: "show", name: "Irreplaceable", root_folder_id: rootId, folder: "I", naming: "{filename}", monitored: true }));
    const file = (episode: number) => ({ name: `I.S01E${episode}.mkv`, season: 1, episode, size: 600 });
    logEvent("info", "Worker started", null, "worker");
    logEvent("warn", "Attempt 1/5 failed", show, "download");
    logEvent("info", "Found 4 new link(s)", show, "check", { kind: "links_found", data: { count: 4 } });
    logEvent("info", "Downloaded a", show, "download", { kind: "downloaded", data: { host: "pixeldrain", bytes: 1200, files: [file(1), file(2)] } });
    logEvent("info", "Downloaded b", show, "download", { kind: "downloaded", data: { host: "gofile", bytes: 600, files: [file(3)] } });
    logEvent("info", "Title edited", show, "web", { kind: "title_edited", data: { changes: ["folder"] } });
    logEvent("warn", "pixeldrain limited", null, "host", { kind: "host_limited", data: { host: "pixeldrain" } });
    logEvent("error", "Failed: x", show, "download", { kind: "download_failed" });

    const now = Date.now();
    const kinds = (f: Parameters<typeof historyEvents>[0]) => historyEvents(f, now).events.map((e) => e.kind);
    expect(kinds({ period: "all" })).toEqual(["download_failed", "host_limited", "title_edited", "downloaded", "downloaded", "links_found"]);
    expect(kinds({ period: "all", category: "downloads" })).toEqual(["downloaded", "downloaded", "links_found"]);
    expect(kinds({ period: "all", category: "library" })).toEqual(["title_edited"]);
    expect(kinds({ period: "all", category: "problems" })).toEqual(["download_failed", "host_limited"]);

    const first = historyEvents({ period: "today", titleId: show }, now).events.at(-1)!;
    expect(first).toMatchObject({ kind: "links_found", title_name: "Irreplaceable", title_type: "show", data: { count: 4 } });

    expect(historySummary({ period: "today" }, now)).toEqual({ downloads: 3, bytes: 1800, titles: 1, linksFound: 4, changes: 1, problems: 2 });
    expect(historyTitles()).toEqual([{ id: show, name: "Irreplaceable" }]);
  });
});

describe("legacyData", () => {
  it("reads details back from the wording of entries written before activity carried them", async () => {
    const { legacyData } = await import("./history");
    expect(legacyData("downloaded", "Downloaded Irreplaceable.S01E16.NF.x264.1080p[MkvDrama.net].mkv from pixeldrain", null)).toEqual({
      host: "pixeldrain",
      files: [{ name: "Irreplaceable.S01E16.NF.x264.1080p[MkvDrama.net].mkv", season: 1, episode: 16, size: null }],
      bytes: undefined,
      skipped: false,
    });
    expect(legacyData("downloaded", "Downloaded 3 files from gofile (1 from other hosts)", null)).toMatchObject({ host: "gofile", files: undefined });
    expect(legacyData("links_found", "Found 10 new link(s) via crate-api", null)).toEqual({ count: 10 });
    expect(legacyData("source_changed", "Source page changed from https://a/c/1 to https://a/c/2", null)).toEqual({ from: "https://a/c/1", to: "https://a/c/2" });
    expect(legacyData("title_deleted", 'Deleted show "Moving"; downloaded files stay on disk', null)).toEqual({ name: "Moving" });
  });
});
