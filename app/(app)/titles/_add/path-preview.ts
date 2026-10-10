// Client-safe mirror of the path rules in lib/paths.ts (sanitizeSegment, renderTemplate,
// normalizeTargetDir) and lib/titles.ts (defaultFolder, fileDestination), so the Add/Edit
// forms can show a live preview without importing node:path. path-preview.test.ts checks
// that the two stay in step.

export type MediaKind = "show" | "movie";

/** Tokens the naming template accepts (same list as lib/paths TEMPLATE_TOKENS). */
export const NAMING_TOKENS = [
  { token: "{filename}", description: "Original file name with extension" },
  { token: "{name}", description: "Original file name without extension" },
  { token: "{ext}", description: "Extension without the dot" },
  { token: "{title}", description: "Show or movie name" },
  { token: "{year}", description: "Release year" },
  { token: "{season}", description: "Season number, 2 digits" },
  { token: "{episode}", description: "Episode number, 2 digits" },
  { token: "{host}", description: "File host, e.g. pixeldrain" },
  { token: "{dir}", description: "Sub-folder inside a remote folder" },
  { token: "{date}", description: "Download date, YYYY-MM-DD" },
  { token: "{month}", description: "Download month, 01-12" },
] as const;

const FORBIDDEN = /[\x00-\x1f\x7f<>:"/\\|?*]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const MAX_BYTES = 255;
const utf8 = new TextEncoder();
const byteLen = (s: string) => utf8.encode(s).length;
const trimEnd = (s: string) => s.replace(/[. ]+$/, "");

function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/** Same as lib/paths sanitizeSegment. */
export function sanitizeSegment(name: string): string {
  let s = trimEnd(name.normalize("NFC").replace(FORBIDDEN, "").trim());
  if (s === "" || s === "." || s === "..") return "_";
  if (RESERVED.test(s.split(".")[0].trim())) s = `_${s}`;
  if (byteLen(s) > MAX_BYTES) {
    let [stem, ext] = splitExt(s);
    if (byteLen(ext) > 32 || ext.includes(" ")) [stem, ext] = [s, ""];
    const chars = Array.from(stem);
    while (chars.length && byteLen(chars.join("") + ext) > MAX_BYTES) chars.pop();
    s = trimEnd(chars.join("")) + ext;
    if (s === "" || s === "." || s === "..") return "_";
  }
  return s;
}

/** Same as lib/titles defaultFolder: "Doctor X", or "Movie Name (2024)" for movies. */
export function defaultFolder(name: string, type: MediaKind, year: number | null): string {
  return sanitizeSegment(type === "movie" && year ? `${name} (${year})` : name);
}

/** Same as lib/paths normalizeTargetDir: a relative folder, or null if absolute/escaping/empty. */
export function normalizeFolder(input: string): string | null {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (trimmed === "" || trimmed.startsWith("/")) return null;
  const out: string[] = [];
  for (const part of trimmed.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.length ? out.join("/") : null;
}

type TemplateVars = {
  title: string;
  host: string;
  filename: string;
  dir: string;
  date: Date;
  season?: number | null;
  episode?: number | null;
  year?: number | null;
};

/** Same as lib/paths renderTemplate. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const clean = (v: string) => v.replace(FORBIDDEN, "");
  const [name, dotExt] = splitExt(vars.filename);
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = vars.date;
  const num = (n: number | null | undefined) => (n == null ? "" : pad(n));
  const values: Record<string, string> = {
    title: clean(vars.title),
    container: clean(vars.title),
    season: num(vars.season),
    episode: num(vars.episode),
    host: clean(vars.host),
    filename: clean(vars.filename),
    name: clean(name),
    ext: clean(dotExt.slice(1)),
    dir: vars.dir
      .split(/[/\\]+/)
      .map((p) => clean(p).trim())
      .filter((p) => p !== "" && p !== "." && p !== "..")
      .join("/"),
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    year: String(vars.year ?? d.getFullYear()),
    month: pad(d.getMonth() + 1),
  };
  const rendered = template.replace(/\{(\w+)\}/g, (m, key: string) => (Object.hasOwn(values, key) ? values[key] : m));
  const segments = rendered
    .split(/[/\\]+/)
    .filter((p) => !["", ".", ".."].includes(clean(p).trim()))
    .map(sanitizeSegment);
  return segments.length ? segments.join("/") : sanitizeSegment(vars.filename);
}

/** A plausible release file name for the preview: "Doctor.X.S01E01.1080p.WEB-DL.mkv". */
export function sampleFilename(name: string, type: MediaKind, year: number | null): string {
  const dotted = name.replace(/[^\p{L}\p{N}]+/gu, ".").replace(/^\.+|\.+$/g, "") || "Title";
  return type === "show" ? `${dotted}.S01E01.1080p.WEB-DL.mkv` : `${dotted}${year ? `.${year}` : ""}.1080p.WEB-DL.mkv`;
}

export type PreviewInput = {
  rootPath: string;
  folder: string;
  type: MediaKind;
  seasonFolders: boolean;
  naming: string;
  name: string;
  year: number | null;
};

export type PreviewParts = {
  root: string;
  /** Normalized folder, or null when the folder isn't valid. */
  folder: string | null;
  season: string | null;
  file: string;
  /** Naming must keep the original name somewhere ({filename} or {name}). */
  namingOk: boolean;
};

/** Where episode 1 (or the movie) would land, split into segments for highlighting. */
export function previewPath(input: PreviewInput, date = new Date()): PreviewParts {
  const naming = input.naming.trim() || "{filename}";
  const filename = sampleFilename(input.name, input.type, input.year);
  const file = renderTemplate(naming, {
    title: input.name || "Title",
    year: input.year,
    filename,
    dir: "",
    host: "pixeldrain",
    date,
    season: input.type === "show" ? 1 : null,
    episode: input.type === "show" ? 1 : null,
  });
  return {
    root: input.rootPath.replace(/\/+$/, "") || "/",
    folder: normalizeFolder(input.folder),
    season: input.type === "show" && input.seasonFolders ? "Season 01" : null,
    file,
    namingOk: naming.includes("{filename}") || naming.includes("{name}"),
  };
}
