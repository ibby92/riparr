import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CircleAlert, History, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { EventLevel } from "@/lib/events";
import { EmptyState, PageHeader } from "../_kit";
import { HISTORY_PERIODS, historyEvents, historyTitles, type HistoryEvent, type HistoryPeriod } from "../_data/history";
import { HistoryFilters } from "./filters";

export const metadata: Metadata = { title: "History" };

type Search = Record<string, string | string[] | undefined>;

export default function HistoryPage({ searchParams }: PageProps<"/history">) {
  return (
    <>
      <PageHeader title="History" subtitle="Everything Riparr did, newest first." />
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <HistoryList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const LEVELS: Record<EventLevel, { label: string; icon: LucideIcon; className: string }> = {
  info: { label: "Info", icon: Info, className: "bg-accent-soft text-accent-ink" },
  warn: { label: "Warning", icon: CircleAlert, className: "bg-warn-soft text-warn" },
  error: { label: "Error", icon: TriangleAlert, className: "bg-critical-soft text-critical" },
};

const PAGE_SIZE = 100;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseFilters(sp: Search) {
  const titleRaw = Number(one(sp.title));
  const levelRaw = one(sp.level);
  const periodRaw = one(sp.period);
  const beforeRaw = Number(one(sp.before));
  return {
    titleId: Number.isInteger(titleRaw) && titleRaw > 0 ? titleRaw : undefined,
    level: levelRaw && levelRaw in LEVELS ? (levelRaw as EventLevel) : undefined,
    period: (periodRaw && periodRaw in HISTORY_PERIODS ? periodRaw : "7d") as HistoryPeriod,
    before: Number.isInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : undefined,
  };
}

const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const yearDayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

function dayLabel(at: number, now: number): string {
  const d = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return (d.getFullYear() === today.getFullYear() ? dayFmt : yearDayFmt).format(d);
}

function groupByDay(events: HistoryEvent[], now: number) {
  const groups: { label: string; events: HistoryEvent[] }[] = [];
  for (const e of events) {
    const label = dayLabel(e.at, now);
    const last = groups.at(-1);
    if (last?.label === label) last.events.push(e);
    else groups.push({ label, events: [e] });
  }
  return groups;
}

async function HistoryList({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();
  const filters = parseFilters(await searchParams);
  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const { events, hasMore } = historyEvents(filters, now, PAGE_SIZE);
  const titles = historyTitles();
  const filtered = filters.titleId !== undefined || filters.level !== undefined || filters.period !== "all";

  const query = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const all = { title: filters.titleId, level: filters.level, period: filters.period, ...extra };
    for (const [k, v] of Object.entries(all)) if (v !== undefined) p.set(k, String(v));
    return `/history?${p}`;
  };

  return (
    <>
      <HistoryFilters>
        <select name="title" aria-label="Title" className="input w-auto max-w-full" defaultValue={filters.titleId ?? ""}>
          <option value="">All titles</option>
          {titles.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select name="level" aria-label="Level" className="input w-auto" defaultValue={filters.level ?? ""}>
          <option value="">All levels</option>
          <option value="info">Info</option>
          <option value="warn">Warnings</option>
          <option value="error">Errors</option>
        </select>
        <select name="period" aria-label="Period" className="input w-auto" defaultValue={filters.period}>
          {(Object.entries(HISTORY_PERIODS) as [HistoryPeriod, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {filters.before !== undefined && (
          <Link href={query({})} className="link text-sm">
            Back to newest
          </Link>
        )}
      </HistoryFilters>

      {events.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={History}
            title={filters.before !== undefined ? "Nothing older" : "Nothing here yet"}
            body={
              filtered
                ? "No events match these filters. Try a longer period or all titles."
                : "Checks, new links, downloads and problems appear here as Riparr works."
            }
            action={
              filtered ? (
                <Link href="/history?period=all" className="btn">
                  Show everything
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="card">
          {groupByDay(events, now).map((g, gi) => (
            <section key={`${g.label}-${gi}`} aria-label={g.label}>
              <h2
                className={`label-caps sticky z-10 border-b border-border bg-surface-2 px-4 pb-2 pt-3 md:px-5 ${gi === 0 ? "rounded-t-md" : "border-t"}`}
                style={{ top: "calc(4rem + env(safe-area-inset-top, 0px))" }}
              >
                {g.label}
              </h2>
              <ul>
                {g.events.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Link href={query({ before: events.at(-1)!.id })} className="btn">
            Older
          </Link>
        </div>
      )}
    </>
  );
}

function EventRow({ event: e }: { event: HistoryEvent }) {
  const level = LEVELS[e.level] ?? LEVELS.info;
  const Icon = level.icon;
  return (
    <li className="grid grid-cols-[44px_28px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 border-b border-border px-4 py-3 text-sm last:border-b-0 md:grid-cols-[52px_28px_minmax(0,1fr)_200px] md:px-5">
      <time dateTime={new Date(e.at).toISOString()} className="pt-1 tabular-nums text-muted">
        {timeFmt.format(e.at)}
      </time>
      <span className={`grid size-7 place-items-center rounded-sm ${level.className}`} role="img" aria-label={level.label}>
        <Icon size={14} strokeWidth={2.25} aria-hidden="true" />
      </span>
      <p className="min-w-0 break-words pt-1 text-fg">{e.message}</p>
      <div className="col-start-3 min-w-0 text-xs md:col-start-4 md:pt-1 md:text-right md:text-sm">
        {e.title_id !== null && e.title_name ? (
          <Link href={`/titles/${e.title_id}`} className="break-words text-accent-ink hover:underline">
            {e.title_name}
          </Link>
        ) : (
          <span className="text-muted">{e.title_id !== null ? "Removed title" : "System"}</span>
        )}
      </div>
    </li>
  );
}
