import path from "node:path";

/**
 * Normalizes a user-supplied directory relative to the downloads root.
 * Returns null if it is absolute or would escape the root.
 */
export function normalizeTargetDir(input: string): string | null {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (trimmed === "" || path.posix.isAbsolute(trimmed)) return null;
  const normalized = path.posix.normalize(trimmed).replace(/\/+$/, "");
  if (normalized === ".." || normalized.startsWith("../")) return null;
  return normalized === "." ? "" : normalized;
}

/** Resolves `rel` under `root`, throwing if the result would land outside it. */
export function resolveInside(root: string, rel: string): string {
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`Path escapes ${base}: ${rel}`);
  }
  return full;
}

const FORBIDDEN = /[\x00-\x1f\x7f<>:"/\\|?*]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const MAX_BYTES = 255;
const utf8 = new TextEncoder();
const byteLen = (s: string) => utf8.encode(s).length;
const trimEnd = (s: string) => s.replace(/[. ]+$/, "");

/** Splits "a.b.mkv" into ["a.b", ".mkv"]; dotfiles and extension-less names get "". */
function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/**
 * Makes one path segment safe on Linux and SMB/NTFS: no separators, control
 * or reserved chars, no trailing dots/spaces, no reserved device names, at
 * most 255 UTF-8 bytes (extension kept). Never returns "", "." or "..".
 */
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

/** Tokens accepted by `renderTemplate`, for the UI form hint. */
export const TEMPLATE_TOKENS = [
  { token: "{title}", description: "Show or movie name" },
  { token: "{season}", description: "Season number, 2 digits (empty if unknown)" },
  { token: "{episode}", description: "Episode number, 2 digits (empty if unknown)" },
  { token: "{host}", description: "File host id, e.g. pixeldrain" },
  { token: "{filename}", description: "File name with extension" },
  { token: "{name}", description: "File name without extension" },
  { token: "{ext}", description: "Extension without the dot" },
  { token: "{dir}", description: "Sub-folder inside a remote folder (may be empty)" },
  { token: "{date}", description: "Download date, YYYY-MM-DD" },
  { token: "{year}", description: "Release year of the title (download year if unknown)" },
  { token: "{month}", description: "Download month, 01-12" },
] as const;

export type TemplateVars = {
  title: string;
  host: string;
  filename: string;
  dir: string;
  /** When the link was found; used by {date}, {month} and as the {year} fallback. */
  date: Date;
  season?: number | null;
  episode?: number | null;
  /** The title's release year. */
  year?: number | null;
};

/**
 * Renders a path template into a safe relative POSIX path. "/" in the template
 * (and in `{dir}`) makes directories; every segment is sanitized and empty
 * ones are dropped. Unknown tokens are left as-is.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const clean = (v: string) => v.replace(FORBIDDEN, "");
  const [name, dotExt] = splitExt(vars.filename);
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = vars.date;
  const num = (n: number | null | undefined) => (n == null ? "" : pad(n));
  const values: Record<string, string> = {
    title: clean(vars.title),
    // Pre-v1 name for {title}, kept so older templates keep working.
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
  const rendered = template.replace(/\{(\w+)\}/g, (m, key: string) =>
    Object.hasOwn(values, key) ? values[key] : m,
  );
  const segments = rendered
    .split(/[/\\]+/)
    .filter((p) => !["", ".", ".."].includes(clean(p).trim()))
    .map(sanitizeSegment);
  return segments.length ? segments.join("/") : sanitizeSegment(vars.filename);
}
