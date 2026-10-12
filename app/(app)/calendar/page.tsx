import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, Rows3 } from "lucide-react";
import { getSettings } from "@/lib/settings";
import { scheduleBetween, scheduleCoverage, type ScheduleItem, type ScheduleState } from "@/lib/schedule";
import { localDay } from "@/lib/time";
import { EmptyState, PageHeader, Poster, episodeLabel } from "../_kit";
import { SegLinks } from "../_library/ui";
import { calendarRange, dayParts, isDayKey, rangeLabel, type CalendarRange, type CalendarView } from "../_data/calendar";

export const metadata: Metadata = { title: "Calendar" };

type Search = Record<string, string | string[] | undefined>;

export default function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  return (
    <Suspense fallback={<div className="card h-[32rem] animate-pulse" />}>
      <Calendar searchParams={searchParams} />
    </Suspense>
  );
}

const STATE: Record<ScheduleState, { label: string; bar: string; pill: string }> = {
  downloaded: { label: "Downloaded", bar: "bg-good", pill: "bg-good-soft text-good" },
  downloading: { label: "Downloading", bar: "bg-accent", pill: "bg-accent-soft text-accent-ink" },
  queued: { label: "On its way", bar: "bg-accent/50", pill: "bg-accent-soft text-accent-ink" },
  missing: { label: "Missing", bar: "bg-critical", pill: "bg-critical-soft text-critical" },
  today: { label: "Airs today", bar: "bg-warn", pill: "bg-warn-soft text-warn" },
  upcoming: { label: "Upcoming", bar: "bg-border-strong", pill: "bg-surface-3 text-fg-2" },
};

const LEGEND: ScheduleState[] = ["downloaded", "downloading", "queued", "missing", "today", "upcoming"];

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

const what = (i: ScheduleItem) => (i.title_type === "movie" ? "Release" : (episodeLabel(i.season ?? 1, i.episode) ?? ""));

async function Calendar({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();
  const sp = await searchParams;
  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const today = localDay(Date.now());
  const view: CalendarView = one(sp.view) === "week" ? "week" : "month";
  const anchorRaw = one(sp.date);
  const anchor = isDayKey(anchorRaw) ? anchorRaw : today;
  const range = calendarRange(view, anchor);
  const items = scheduleBetween(range.from, range.to, today);
  const byDay = new Map<string, ScheduleItem[]>();
  for (const i of items) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
  const coverage = scheduleCoverage();
  const tmdb = Boolean(getSettings().tmdbApiKey);
  const href = (change: { view?: CalendarView; date?: string }) => {
    const p = new URLSearchParams({ view: change.view ?? view, date: change.date ?? anchor });
    return `/calendar?${p}`;
  };
  const counts = LEGEND.map((s) => [s, items.filter((i) => i.state === s).length] as const);

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="When your shows' episodes and your movies come out, from TMDB, and what Riparr already has."
        actions={
          <SegLinks
            label="View"
            items={[
              { href: href({ view: "week" }), active: view === "week", label: "Week", icon: Rows3 },
              { href: href({ view: "month" }), active: view === "month", label: "Month", icon: LayoutGrid },
            ]}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-1.5">
          <Link href={href({ date: range.prev })} className="btn h-9 min-h-0 px-2.5" aria-label={view === "week" ? "Previous week" : "Previous month"}>
            <ChevronLeft size={17} strokeWidth={1.75} aria-hidden="true" />
          </Link>
          <Link href={href({ date: today })} className="btn h-9 min-h-0 px-3 text-[13px]">
            Today
          </Link>
          <Link href={href({ date: range.next })} className="btn h-9 min-h-0 px-2.5" aria-label={view === "week" ? "Next week" : "Next month"}>
            <ChevronRight size={17} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </div>
        <h2 className="font-display text-xl font-medium text-fg">{rangeLabel(view, range)}</h2>
        <ul className="ml-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-label="Legend">
          {counts.map(([s, n]) => (
            <li key={s} className="inline-flex items-center gap-1.5">
              <i className={`h-2.5 w-1 rounded-full ${STATE[s].bar}`} aria-hidden="true" />
              {STATE[s].label}
              {n > 0 && <span className="tabular-nums text-fg-2">{n}</span>}
            </li>
          ))}
        </ul>
      </div>

      {!tmdb ? (
        <div className="card">
          <EmptyState
            icon={CalendarDays}
            title="Connect TMDB to see air dates"
            body="The calendar comes from TMDB's episode schedule for the shows and movies you've matched. Add a free TMDB API key, and it fills in within a minute."
            action={
              <Link href="/settings/connections" className="btn btn-primary">
                Open Connections
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {(coverage.unmatched > 0 || coverage.synced < coverage.matched) && (
            <p className="mb-3 text-[13px] text-muted">
              {coverage.synced < coverage.matched && `Reading air dates from TMDB for ${coverage.matched - coverage.synced} title(s)… `}
              {coverage.unmatched > 0 &&
                `${coverage.unmatched} ${coverage.unmatched === 1 ? "title isn't" : "titles aren't"} matched on TMDB, so ${coverage.unmatched === 1 ? "it isn't" : "they aren't"} on the calendar (match ${coverage.unmatched === 1 ? "it" : "them"} with Edit).`}
            </p>
          )}
          {view === "month" ? <MonthGrid range={range} byDay={byDay} today={today} /> : <WeekGrid range={range} byDay={byDay} today={today} />}
          <Agenda range={range} byDay={byDay} today={today} />
        </>
      )}
    </>
  );
}

function Chip({ i }: { i: ScheduleItem }) {
  const s = STATE[i.state];
  return (
    <Link
      href={`/titles/${i.title_id}`}
      title={`${i.title_name} ${what(i)}${i.name ? ` · ${i.name}` : ""} · ${s.label}${i.monitored ? "" : " (paused)"}`}
      className={`flex min-w-0 items-center gap-1.5 rounded-xs bg-surface px-1.5 py-1 text-[11.5px] leading-tight hover:bg-surface-3 ${i.monitored ? "" : "opacity-60"}`}
    >
      <i className={`h-3.5 w-1 shrink-0 rounded-full ${s.bar}`} aria-hidden="true" />
      <span className="min-w-0 truncate text-fg">{i.title_name}</span>
      <span className="shrink-0 tabular-nums text-muted">{i.title_type === "movie" ? "" : `E${String(i.episode).padStart(2, "0")}`}</span>
    </Link>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Month: a 7-column grid of whole weeks (desktop). */
function MonthGrid({ range, byDay, today }: { range: CalendarRange; byDay: Map<string, ScheduleItem[]>; today: string }) {
  return (
    <div className="card hidden overflow-hidden md:block">
      <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-xs font-medium text-muted">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2.5 py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {range.days.map((d, idx) => {
          const items = byDay.get(d) ?? [];
          const inMonth = d.startsWith(range.month ?? "");
          return (
            <div
              key={d}
              className={`min-h-28 min-w-0 border-border p-1.5 ${idx % 7 ? "border-l" : ""} ${idx >= 7 ? "border-t" : ""} ${inMonth ? "" : "bg-surface-2/60"} ${d === today ? "bg-accent-soft" : ""}`}
            >
              <div className={`mb-1 px-1 text-xs tabular-nums ${d === today ? "font-semibold text-accent-ink" : inMonth ? "text-fg-2" : "text-faint"}`}>
                {dayParts(d).day}
                {d === today && <span className="ml-1 font-normal">Today</span>}
              </div>
              <div className="flex flex-col gap-1">
                {items.map((i) => (
                  <Chip key={`${i.title_id}-${i.season}-${i.episode}`} i={i} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Week: seven columns with posters and episode names (desktop). */
function WeekGrid({ range, byDay, today }: { range: CalendarRange; byDay: Map<string, ScheduleItem[]>; today: string }) {
  return (
    <div className="hidden grid-cols-7 gap-2 md:grid">
      {range.days.map((d) => {
        const p = dayParts(d);
        const items = byDay.get(d) ?? [];
        return (
          <section key={d} className={`card min-h-64 min-w-0 p-2 ${d === today ? "outline outline-1 outline-accent" : ""}`} aria-label={p.long}>
            <h3 className={`mb-2 px-1 text-xs ${d === today ? "font-semibold text-accent-ink" : "text-muted"}`}>
              {p.weekday} <span className="font-display text-lg tabular-nums text-fg">{p.day}</span>
              {d === today && <span className="ml-1">Today</span>}
            </h3>
            <div className="flex flex-col gap-2">
              {items.map((i) => (
                <WeekItem key={`${i.title_id}-${i.season}-${i.episode}`} i={i} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function WeekItem({ i }: { i: ScheduleItem }) {
  const s = STATE[i.state];
  return (
    <Link href={`/titles/${i.title_id}`} className={`block rounded-sm bg-surface-2 p-1.5 hover:bg-surface-3 ${i.monitored ? "" : "opacity-60"}`}>
      <div className="flex gap-2">
        <Poster id={i.title_id} name={i.title_name} year={i.year} hasPoster={i.has_poster} className="w-9 shrink-0 rounded-[3px]" />
        <div className="min-w-0">
          <p className="line-clamp-2 text-xs font-medium leading-snug text-fg">{i.title_name}</p>
          <p className="text-[11px] tabular-nums text-muted">{what(i)}</p>
        </div>
      </div>
      {i.name && <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-fg-2">{i.name}</p>}
      <span className={`mt-1.5 inline-block rounded-pill px-1.5 py-px text-[10.5px] font-medium ${s.pill}`}>{s.label}</span>
    </Link>
  );
}

/** Phones: the period as a list of the days that have something, today marked. */
function Agenda({ range, byDay, today }: { range: CalendarRange; byDay: Map<string, ScheduleItem[]>; today: string }) {
  const days = range.days.filter((d) => byDay.has(d) && (!range.month || d.startsWith(range.month)));
  if (!days.length) {
    return (
      <div className="card md:hidden">
        <EmptyState icon={CalendarDays} title="Nothing scheduled" body="No episodes or releases in this period." />
      </div>
    );
  }
  return (
    <div className="card divide-y divide-border md:hidden">
      {days.map((d) => (
        <section key={d} aria-label={dayParts(d).long}>
          <h3 className={`label-caps bg-surface-2 px-4 py-2 ${d === today ? "text-accent-ink" : ""}`}>
            {d === today ? `Today · ${dayParts(d).long}` : dayParts(d).long}
          </h3>
          <ul className="divide-y divide-border">
            {(byDay.get(d) ?? []).map((i) => {
              const s = STATE[i.state];
              return (
                <li key={`${i.title_id}-${i.season}-${i.episode}`}>
                  <Link href={`/titles/${i.title_id}`} className={`flex items-center gap-3 px-4 py-2.5 ${i.monitored ? "" : "opacity-60"}`}>
                    <Poster id={i.title_id} name={i.title_name} year={i.year} hasPoster={i.has_poster} className="w-8 shrink-0 rounded-[3px]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{i.title_name}</p>
                      <p className="truncate text-xs text-muted">
                        {what(i)}
                        {i.name ? ` · ${i.name}` : ""}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-medium ${s.pill}`}>{s.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
