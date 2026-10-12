// The time zone every time and day in Riparr is shown in: the setting (Settings → General), else the
// container's TZ. Both processes apply it to themselves (process.env.TZ), so Date's local methods
// (day boundaries, "today", the {date} naming token) follow it too.
import { getSetting } from "./settings";

/** The process's own zone at start-up (Docker's TZ), the fallback when nothing is set. */
const SERVER_ZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const KEY = "general.time_zone";
const CACHE_MS = 10_000;
let cached: { zone: string; at: number } | null = null;

/** True for zone names this runtime knows (IANA, e.g. "Europe/London", or "UTC"). */
export function isTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The zone from Settings, or "" when none is chosen. */
export function chosenTimeZone(): string {
  try {
    const raw = getSetting(KEY);
    const zone = raw ? (JSON.parse(raw) as string) : "";
    return isTimeZone(zone) ? zone : "";
  } catch {
    return "";
  }
}

/** The zone in effect: the setting, else the container's. Also applies it to this process. */
export function timeZone(now = Date.now()): string {
  if (!cached || now - cached.at >= CACHE_MS) cached = { zone: chosenTimeZone() || SERVER_ZONE, at: now };
  if (process.env.TZ !== cached.zone) process.env.TZ = cached.zone;
  return cached.zone;
}

/** The container's own zone (what "Use the server's time zone" means). */
export function serverTimeZone(): string {
  return SERVER_ZONE;
}

/** Forget the cached zone (after the setting changes). */
export function resetTimeZoneCache() {
  cached = null;
  timeZone();
}

/** Every zone this runtime knows, for the picker. */
export function timeZones(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

/** A formatter in the current zone (created per call: formatters keep the zone they were made with). */
export function formatter(options: Intl.DateTimeFormatOptions, locale = "en-GB"): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: timeZone() });
}

/** "09:44" in the current zone. */
export function clockTime(at: number): string {
  return formatter({ hour: "2-digit", minute: "2-digit" }).format(at);
}

/** "12 Oct, 09:44" in the current zone. */
export function dateTime(at: number): string {
  return formatter({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(at);
}

/** Day key, e.g. "2026-10-10", in the current zone. */
export function localDay(at: number): string {
  timeZone();
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The day key `days` days before the one containing `at`. */
export function localDayBefore(at: number, days: number): string {
  timeZone();
  const d = new Date(at);
  d.setDate(d.getDate() - days);
  return localDay(d.getTime());
}

/** Midnight at the start of the day `daysBack` days before the one containing `at`. */
export function startOfDay(at: number, daysBack = 0): number {
  timeZone();
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.getTime();
}

/** Midnight at the start of a "YYYY-MM-DD" day key. */
export function startOfDayKey(key: string): number {
  timeZone();
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** "Today", "Yesterday", or a date like "Sat 10 Oct" ("Sat 10 Oct 2025" in other years). */
export function dayLabel(at: number, now: number, style: "short" | "long" = "short"): string {
  const key = localDay(at);
  if (key === localDay(now)) return "Today";
  if (key === localDayBefore(now, 1)) return "Yesterday";
  const sameYear = key.slice(0, 4) === localDay(now).slice(0, 4);
  return formatter(
    style === "long" && sameYear
      ? { weekday: "long", day: "numeric", month: "long" }
      : { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) },
  ).format(at);
}
