import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./db";
import { migrate, SCHEMA_VERSION } from "./db/migrations";
import { sendCommand, takeCommands } from "./commands";
import { logEvent, recentEvents } from "./events";
import { addLinks, upsertFiles, updateFile } from "./links";
import { addRootFolder, listDirectories, listRootFolders, removeRootFolder, rootFolderError } from "./root-folders";
import { createSource, dueSources, findSourceByUrl, recordCheck, sourceInput } from "./sources";
import { createTitle, defaultFolder, fileDestination, getTitle, rollUpStatus, titleInput } from "./titles";

let dir: string;
let media: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-test-"));
  media = path.join(dir, "media");
  fs.mkdirSync(path.join(media, "Kdrama"), { recursive: true });
  fs.mkdirSync(path.join(media, "Movies"), { recursive: true });
  process.env.RIPARR_CONFIG_DIR = path.join(dir, "config");
});

afterAll(() => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

const showForm = (rootId: number) => ({
  type: "show",
  name: "Doctor X",
  year: "2024",
  tmdb_id: "",
  root_folder_id: String(rootId),
  folder: "Doctor X/",
  season_folders: "on",
  naming: "{filename}",
  monitored: "on",
});

describe("titleInput / sourceInput", () => {
  it("parses form data", () => {
    expect(titleInput.parse(showForm(1))).toMatchObject({
      type: "show",
      name: "Doctor X",
      year: 2024,
      tmdb_id: null,
      root_folder_id: 1,
      folder: "Doctor X",
      season_folders: true,
      monitored: true,
    });
    expect(sourceInput.parse({ url: "https://crate.example/c/1", password: "" })).toEqual({
      url: "https://crate.example/c/1",
      password: null,
      poll_interval_min: 60,
      enabled: true,
      poll: true,
    });
  });

  it.each([
    ["folder", "../escape"],
    ["folder", ""],
    ["naming", "{title}"],
    ["year", "12"],
    ["type", "anime"],
  ])("rejects bad %s", (field, value) => {
    expect(titleInput.safeParse({ ...showForm(1), [field]: value }).success).toBe(false);
  });

  it("names folders like the *arr apps", () => {
    expect(defaultFolder("Doctor X", "show", 2024)).toBe("Doctor X");
    expect(defaultFolder("Movie: The Sequel", "movie", 2024)).toBe("Movie The Sequel (2024)");
  });
});

describe("fileDestination", () => {
  const show = { type: "show" as const, name: "Doctor X", year: 2024, folder: "Doctor X", season_folders: 1, naming: "{filename}" };
  const vars = { filename: "Doctor.X.S01E05.1080p.mkv", dir: "", host: "gofile", date: new Date(2026, 0, 1) };

  it("puts episodes in season folders, or not", () => {
    expect(fileDestination(show, "/media/Kdrama", { ...vars, season: 1, episode: 5 })).toBe(
      "/media/Kdrama/Doctor X/Season 01/Doctor.X.S01E05.1080p.mkv",
    );
    expect(fileDestination({ ...show, season_folders: 0 }, "/media/Kdrama", { ...vars, season: 1, episode: 5 })).toBe(
      "/media/Kdrama/Doctor X/Doctor.X.S01E05.1080p.mkv",
    );
    // Season unknown: straight into the title folder.
    expect(fileDestination(show, "/media/Kdrama", vars)).toBe("/media/Kdrama/Doctor X/Doctor.X.S01E05.1080p.mkv");
  });

  it("never uses season folders for movies and applies naming", () => {
    const movie = {
      type: "movie" as const,
      name: "Parasite",
      year: 2019,
      folder: "Parasite (2019)",
      season_folders: 1,
      naming: "{title} ({year}).{ext}",
    };
    expect(fileDestination(movie, "/media/Movies", { ...vars, filename: "parasite.2019.mkv", season: 1 })).toBe(
      "/media/Movies/Parasite (2019)/Parasite (2019).mkv",
    );
  });

  it("can't escape the root folder", () => {
    const evil = { ...show, naming: "{dir}/{filename}" };
    const out = fileDestination(evil, "/media/Kdrama", { ...vars, dir: "../../../etc", filename: "../passwd" });
    expect(out.startsWith("/media/Kdrama/Doctor X/")).toBe(true);
  });
});

describe("rollUpStatus", () => {
  it.each([
    [true, [], "ok"],
    [true, ["ok", "pending"], "pending"],
    [true, ["ok", "error"], "error"],
    [true, ["error", "needs_attention"], "needs_attention"],
    [false, ["needs_attention"], "paused"],
  ] as const)("%s %j -> %s", (monitored, statuses, expected) => {
    expect(rollUpStatus(monitored, [...statuses])).toBe(expected);
  });
});

describe("database", () => {
  let rootId: number;
  let titleId: number;
  let sourceId: number;

  it("is at the latest schema and migrations are idempotent", () => {
    migrate(getDb());
    expect(getDb().prepare("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION });
  });

  it("validates and lists root folders with free space", () => {
    expect(rootFolderError("relative/path")).toMatch(/absolute/);
    expect(rootFolderError(path.join(media, "missing"))).toMatch(/doesn't exist/);
    expect(rootFolderError(path.join(media, "Kdrama"))).toBeNull();
    rootId = addRootFolder(path.join(media, "Kdrama") + "/");
    expect(addRootFolder(path.join(media, "Kdrama"))).toBe(rootId);
    const [root] = listRootFolders();
    expect(root).toMatchObject({ path: path.join(media, "Kdrama"), accessible: true, title_count: 0 });
    expect(root.free_bytes).toBeGreaterThan(0);
  });

  it("lists folders for the picker, hiding dot-folders", () => {
    fs.mkdirSync(path.join(media, ".hidden"));
    const listing = listDirectories(media);
    expect(listing.dirs.map((d) => d.name)).toEqual(["Kdrama", "Movies"]);
    expect(listing.parent).toBe(dir);
    expect(() => listDirectories(path.join(media, "nope"))).toThrow(/doesn't exist/);
  });

  it("creates titles with sources; only polled sources are due", () => {
    titleId = createTitle(titleInput.parse(showForm(rootId)));
    sourceId = createSource(titleId, sourceInput.parse({ url: "https://crate.example/c/1", password: "pw" }));
    createSource(titleId, sourceInput.parse({ url: "https://other.example/c/9", poll: false }));

    expect(getTitle(titleId)).toMatchObject({
      name: "Doctor X",
      root_path: path.join(media, "Kdrama"),
      source_count: 2,
      status: "pending",
    });
    expect(findSourceByUrl("https://crate.example/c/1")?.id).toBe(sourceId);
    expect(dueSources().map((s) => s.url)).toEqual(["https://crate.example/c/1"]);

    recordCheck(sourceId, { status: "ok", changed: true, nextCheckAt: Date.now() + 60_000 });
    expect(dueSources()).toEqual([]);
    expect(removeRootFolder(rootId)).toBe(false);
  });

  it("de-duplicates links across a title's sources and counts episodes", () => {
    expect(addLinks(titleId, sourceId, ["https://pixeldrain.com/u/a", "https://gofile.io/d/b"])).toBe(2);
    // Another site listing the same host link doesn't add it again.
    expect(addLinks(titleId, null, ["https://www.pixeldrain.com/u/a"])).toBe(0);

    const linkId = Number(getDb().prepare("SELECT id FROM links WHERE url LIKE '%pixeldrain%'").get()!.id);
    const [file] = upsertFiles(linkId, [{ key: "a", name: "Doctor.X.S01E03.mkv", dir: "", size: 10, hash: null }]);
    expect(file).toMatchObject({ season: 1, episode: 3, status: "standby" });
    updateFile(file.id, { status: "done" });
    expect(getTitle(titleId)).toMatchObject({ episodes_done: 1, episodes_seen: 1, link_count: 2 });
  });

  it("delivers each command once", () => {
    sendCommand({ type: "check_now", sourceId: 1 });
    sendCommand({ type: "check_title", titleId: 2 });
    expect(takeCommands()).toEqual([
      { type: "check_now", sourceId: 1 },
      { type: "check_title", titleId: 2 },
    ]);
    expect(takeCommands()).toEqual([]);
  });

  it("lists recent activity newest first, with the title name, leaving out plain log entries", () => {
    logEvent("info", "first", titleId, "download", { kind: "downloaded", data: { host: "gofile", bytes: 5 } });
    logEvent("info", "worker detail", titleId, "worker");
    logEvent("error", "second", titleId, "download", { kind: "download_failed" });
    expect(recentEvents(5, titleId).map((e) => [e.message, e.title_name, e.activity])).toEqual([
      ["second", "Doctor X", "download_failed"],
      ["first", "Doctor X", "downloaded"],
    ]);
    expect(JSON.parse(recentEvents(5, titleId)[1].data!)).toEqual({ host: "gofile", bytes: 5 });
  });
});
