// Date ranges for the calendar views. Days are "YYYY-MM-DD" keys; the arithmetic is on UTC dates, so
// it never shifts with time zones (which day "today" is comes from lib/time).

export type CalendarView = "month" | "week";

const DAY = 24 * 60 * 60 * 1000;

function toUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(key: string, days: number): string {
  return toKey(toUtc(key) + days * DAY);
}

/** Monday of the week containing `key`. */
export function startOfWeek(key: string): string {
  const dow = (new Date(toUtc(key)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(key, -dow);
}

export function addMonths(key: string, months: number): string {
  const d = new Date(toUtc(key));
  return toKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}

export function isDayKey(v: string | undefined): v is string {
  return Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toUtc(v)) && toKey(toUtc(v)) === v);
}

export type CalendarRange = {
  /** First and last day shown (whole weeks, Monday to Sunday). */
  from: string;
  to: string;
  /** Every day shown, in order. */
  days: string[];
  /** The month a month view is about ("2026-10"), to dim days outside it. */
  month: string | null;
  /** Anchors for the previous and next period. */
  prev: string;
  next: string;
};

/** The days a view shows around `anchor`: its week, or its month padded to whole weeks. */
export function calendarRange(view: CalendarView, anchor: string): CalendarRange {
  if (view === "week") {
    const from = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    return { from, to: days[6], days, month: null, prev: addDays(from, -7), next: addDays(from, 7) };
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const last = addDays(addMonths(first, 1), -1);
  const from = startOfWeek(first);
  const to = addDays(startOfWeek(last), 6);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return { from, to, days, month: anchor.slice(0, 7), prev: addMonths(first, -1), next: addMonths(first, 1) };
}

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });

/** "October 2026", or "12 – 18 Oct 2026" for a week. */
export function rangeLabel(view: CalendarView, range: CalendarRange): string {
  if (view === "month") return fmt({ month: "long", year: "numeric" }).format(toUtc(`${range.month}-01`));
  const a = toUtc(range.from);
  const b = toUtc(range.to);
  const sameMonth = range.from.slice(0, 7) === range.to.slice(0, 7);
  return `${fmt(sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" }).format(a)} – ${fmt({ day: "numeric", month: "short", year: "numeric" }).format(b)}`;
}

/** "Mon", "12", "Monday 12 October" for a day key. */
export function dayParts(key: string) {
  const t = toUtc(key);
  return {
    weekday: fmt({ weekday: "short" }).format(t),
    day: Number(key.slice(8, 10)),
    long: fmt({ weekday: "long", day: "numeric", month: "long" }).format(t),
  };
}
