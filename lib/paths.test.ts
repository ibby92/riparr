import { describe, expect, it } from "vitest";
import { normalizeTargetDir, renderTemplate, resolveInside, sanitizeSegment, TEMPLATE_TOKENS } from "./paths";

describe("normalizeTargetDir", () => {
  it.each([
    ["tv/My Show", "tv/My Show"],
    ["  movies/  ", "movies"],
    ["a//b/./c/", "a/b/c"],
    ["a\\b", "a/b"],
    ["a/../b", "b"],
    [".", ""],
  ])("accepts %j", (input, expected) => {
    expect(normalizeTargetDir(input)).toBe(expected);
  });

  it.each(["", "/etc", "..", "../x", "a/../../x", "\\\\server\\share"])("rejects %j", (input) => {
    expect(normalizeTargetDir(input)).toBeNull();
  });
});

describe("resolveInside", () => {
  it("resolves paths under the root", () => {
    expect(resolveInside("/downloads", "tv/show/ep.mkv")).toBe("/downloads/tv/show/ep.mkv");
    expect(resolveInside("/downloads", "")).toBe("/downloads");
  });

  it("throws on escapes", () => {
    expect(() => resolveInside("/downloads", "../etc/passwd")).toThrow();
    expect(() => resolveInside("/downloads", "/etc/passwd")).toThrow();
    expect(() => resolveInside("/downloads", "x/../../downloads-evil")).toThrow();
  });
});

const byteLen = (s: string) => Buffer.byteLength(s, "utf8");

describe("sanitizeSegment", () => {
  it.each([
    ["Movie: The Sequel?.mkv", "Movie The Sequel.mkv"],
    ['a<b>c"d|e*f\\g/h', "abcdefgh"],
    ["tab\there\u0000.txt", "tabhere.txt"],
    ["name. . .", "name"],
    ["  spaced  ", "spaced"],
    ["", "_"],
    [".", "_"],
    ["..", "_"],
    ["...", "_"],
    ["???", "_"],
    ["CON", "_CON"],
    ["nul.txt", "_nul.txt"],
    ["com1.tar.gz", "_com1.tar.gz"],
    ["LPT9", "_LPT9"],
    ["console.log", "console.log"],
    [".hidden", ".hidden"],
  ])("%j -> %j", (input, expected) => {
    expect(sanitizeSegment(input)).toBe(expected);
  });

  it("caps long unicode names at 255 bytes and keeps the extension", () => {
    const out = sanitizeSegment("日本語".repeat(100) + "😀.mkv");
    expect(byteLen(out)).toBeLessThanOrEqual(255);
    expect(out.endsWith(".mkv")).toBe(true);
    expect(out).not.toMatch(/\uFFFD/);
    expect(out.startsWith("日本語")).toBe(true);
  });

  it("doesn't split surrogate pairs", () => {
    const out = sanitizeSegment("😀".repeat(100));
    expect(byteLen(out)).toBeLessThanOrEqual(255);
    expect(Array.from(out).every((c) => c === "😀")).toBe(true);
  });

  it("truncates without an extension when the 'extension' is huge", () => {
    const out = sanitizeSegment("a." + "b".repeat(300));
    expect(byteLen(out)).toBe(255);
  });
});

describe("renderTemplate", () => {
  const base = {
    title: "My Show",
    host: "pixeldrain",
    filename: "Episode 01.mkv",
    dir: "Season 1",
    date: new Date(2026, 2, 7, 23, 30),
  };

  it("lists its tokens", () => {
    expect(TEMPLATE_TOKENS.map((t) => t.token)).toContain("{dir}");
  });

  it.each([
    ["{title}/{dir}/{filename}", {}, "My Show/Season 1/Episode 01.mkv"],
    ["{title}/{dir}/{filename}", { dir: "" }, "My Show/Episode 01.mkv"],
    ["{dir}/{filename}", { dir: "" }, "Episode 01.mkv"],
    ["{dir}/{filename}", { dir: "A/B//C/" }, "A/B/C/Episode 01.mkv"],
    ["{host}/{year}/{month}/{name}.{ext}", {}, "pixeldrain/2026/03/Episode 01.mkv"],
    ["{date} - {filename}", {}, "2026-03-07 - Episode 01.mkv"],
    ["{name}.{ext}", { filename: "README" }, "README"],
    ["{title}/{unknown}/{filename}", {}, "My Show/{unknown}/Episode 01.mkv"],
    ["{container}/{filename}", {}, "My Show/Episode 01.mkv"],
    ["{title} - S{season}E{episode}.{ext}", { season: 1, episode: 5 }, "My Show - S01E05.mkv"],
    ["{title} ({year})/{filename}", { year: 2024 }, "My Show (2024)/Episode 01.mkv"],
    ["S{season}/{filename}", { season: null }, "S/Episode 01.mkv"],
    ["{filename}", { filename: "../../etc/passwd" }, "....etcpasswd"],
    ["{dir}/{filename}", { dir: "../../etc" }, "etc/Episode 01.mkv"],
    ["{dir}/{filename}", { dir: "a/../../b/./c" }, "a/b/c/Episode 01.mkv"],
    ["{dir}/{filename}", { dir: "..\\..\\x" }, "x/Episode 01.mkv"],
    ["../../{filename}", {}, "Episode 01.mkv"],
    ["/abs/{filename}", {}, "abs/Episode 01.mkv"],
    ["{title}/{filename}", { title: "CON" }, "_CON/Episode 01.mkv"],
    ["{title}/{filename}", { title: "What?: A/B" }, "What AB/Episode 01.mkv"],
    ["{title}/{filename}", { title: "..." }, "_/Episode 01.mkv"],
    ["{dir}", { dir: "" }, "Episode 01.mkv"],
  ])("%j %j -> %j", (template, overrides, expected) => {
    expect(renderTemplate(template, { ...base, ...overrides })).toBe(expected);
  });

  it("never escapes or produces absolute paths", () => {
    const evil = ["..", "../..", "/etc", "\\..\\..", ". .", "a/../..", ""];
    for (const v of evil) {
      const out = renderTemplate("{title}/{dir}/{filename}", { ...base, title: v, dir: v, filename: v });
      expect(out.startsWith("/")).toBe(false);
      expect(out.split("/")).not.toContain("..");
      expect(out.split("/")).not.toContain(".");
      expect(out.split("/")).not.toContain("");
      expect(normalizeTargetDir(out)).toBe(out);
    }
  });

  it("caps each segment", () => {
    const out = renderTemplate("{title}/{filename}", { ...base, title: "x".repeat(400), filename: "é".repeat(400) + ".mkv" });
    for (const seg of out.split("/")) expect(byteLen(seg)).toBeLessThanOrEqual(255);
    expect(out.endsWith(".mkv")).toBe(true);
  });
});
