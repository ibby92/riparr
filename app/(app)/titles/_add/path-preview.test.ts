import path from "node:path";
import { describe, expect, it } from "vitest";
import * as lib from "@/lib/paths";
import { defaultFolder, normalizeFolder, previewPath, renderTemplate, sampleFilename, sanitizeSegment } from "./path-preview";

const date = new Date(2026, 9, 10);

describe("path preview mirrors lib/paths", () => {
  it.each(["Doctor X", "Doctor X: Mafia in White", "con", "a/b\\c", "..", "  trailing. ", "x".repeat(300) + ".mkv", "Ünïcødé 名前"])(
    "sanitizeSegment(%j)",
    (name) => expect(sanitizeSegment(name)).toBe(lib.sanitizeSegment(name)),
  );

  it.each(["Doctor X", "/abs", "a/../b", "../x", ".", "", "a//b/", "a\\b", "Season 01/./x"])("normalizeFolder(%j)", (input) => {
    expect(normalizeFolder(input)).toBe(lib.normalizeTargetDir(input) || null);
  });

  it.each(["{filename}", "{title}.S{season}E{episode}.{ext}", "{title} ({year})/{name}.{ext}", "{unknown}-{host}-{date}-{month}", "../{filename}", ""])(
    "renderTemplate(%j)",
    (template) => {
      const vars = { title: "Doctor X: Mafia", filename: "Doctor.X.S01E01.mkv", dir: "a/../b", host: "gofile", date, season: 1, episode: 2, year: 2026 };
      expect(renderTemplate(template, vars)).toBe(lib.renderTemplate(template, vars));
    },
  );

  it("defaultFolder adds the year to movies only", () => {
    expect(defaultFolder("Harbor Lights", "movie", 2026)).toBe("Harbor Lights (2026)");
    expect(defaultFolder("Doctor X: Mafia", "show", 2026)).toBe("Doctor X Mafia");
  });
});

describe("previewPath", () => {
  it("matches fileDestination's layout for a show with season folders", () => {
    const p = previewPath(
      { rootPath: "/media/Kdrama/", folder: "Doctor X", type: "show", seasonFolders: true, naming: "{filename}", name: "Doctor X", year: 2026 },
      date,
    );
    expect(p).toEqual({ root: "/media/Kdrama", folder: "Doctor X", season: "Season 01", file: "Doctor.X.S01E01.1080p.WEB-DL.mkv", namingOk: true });
    const expected = path.posix.join("/media/Kdrama", "Doctor X", "Season 01", lib.renderTemplate("{filename}", { title: "Doctor X", filename: sampleFilename("Doctor X", "show", 2026), dir: "", host: "pixeldrain", date, season: 1, episode: 1, year: 2026 }));
    expect([p.root, p.folder, p.season, p.file].join("/")).toBe(expected);
  });

  it("never uses season folders for movies and flags naming without the file name", () => {
    const p = previewPath(
      { rootPath: "/media/Movies", folder: "../x", type: "movie", seasonFolders: true, naming: "{title}", name: "Harbor Lights", year: 2026 },
      date,
    );
    expect(p.season).toBeNull();
    expect(p.folder).toBeNull();
    expect(p.namingOk).toBe(false);
    expect(p.file).toBe("Harbor Lights");
  });
});
