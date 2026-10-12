import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Bug, ScrollText } from "lucide-react";
import { debugForcedByEnv, debugLogging, LOG_COMPONENTS, type EventLevel, type LogComponent } from "@/lib/events";
import { formatter, localDay } from "@/lib/time";
import { EmptyState, PageHeader } from "../../_kit";
import { logEntries, logStats, logTitles, type LogEntry, type LogFilter } from "../../_data/logs";
import { HistoryFilters } from "../../history/filters";
import { setLogLevel } from "../actions";

export const metadata: Metadata = { title: "Logs" };

type Search = Record<string, string | string[] | undefined>;

export default function LogsPage({ searchParams }: PageProps<"/system/logs">) {
  return (
    <>
      <PageHeader
        title="Logs"
        subtitle="Everything Riparr records, including step-by-step debug detail for troubleshooting. History shows the same events without the debug entries."
        actions={
          <Suspense fallback={null}>
            <DebugSwitch />
          </Suspense>
        }
      />
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <LogList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function DebugSwitch() {
  await connection();
  const on = debugLogging();
  const forced = debugForcedByEnv();
  return (
    <form action={setLogLevel} className="flex items-center gap-2">
      <input type="hidden" name="level" value={on ? "info" : "debug"} />
      <button
        className={`btn ${on ? "" : "btn-primary"}`}
        disabled={forced}
        title={forced ? "RIPARR_LOG_LEVEL=debug is set, so debug logging stays on" : undefined}
      >
        <Bug size={16} strokeWidth={1.75} aria-hidden="true" />
        {on ? "Turn off debug logging" : "Turn on debug logging"}
      </button>
    </form>
  );
}

const LEVELS: Record<EventLevel, { label: string; className: string }> = {
  debug: { label: "Debug", className: "bg-surface-3 text-muted" },
  info: { label: "Info", className: "bg-accent-soft text-accent-ink" },
  warn: { label: "Warn", className: "bg-warn-soft text-warn" },
  error: { label: "Error", className: "bg-critical-soft text-critical" },
};

const MIN_LEVELS: Record<EventLevel, string> = {
  debug: "Everything (debug and up)",
  info: "Info and up",
  warn: "Warnings and errors",
  error: "Errors only",
};

const PAGE_SIZE = 200;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseFilters(sp: Search): LogFilter {
  const level = one(sp.level);
  const component = one(sp.area);
  const title = Number(one(sp.title));
  const before = Number(one(sp.before));
  const text = one(sp.q)?.trim().slice(0, 200);
  return {
    minLevel: level && level in MIN_LEVELS ? (level as EventLevel) : "info",
    component: component && component in LOG_COMPONENTS ? (component as LogComponent) : undefined,
    titleId: Number.isInteger(title) && title > 0 ? title : undefined,
    text: text || undefined,
    before: Number.isInteger(before) && before > 0 ? before : undefined,
  };
}

// Created per render: formatters keep the time zone they were made with (lib/time.ts).
const timeFmt = { format: (at: number) => formatter({ hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(at) };
const dateFmt = { format: (at: number) => formatter({ day: "numeric", month: "short" }).format(at) };

async function LogList({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();
  const filters = parseFilters(await searchParams);
  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const { entries, hasMore } = logEntries(filters, PAGE_SIZE);
  const stats = logStats();
  const titles = logTitles();
  const debugOn = debugLogging();
  const total = Object.values(stats.counts).reduce((a, b) => a + b, 0);
  const today = localDay(now);

  const query = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const all = { level: filters.minLevel, area: filters.component, title: filters.titleId, q: filters.text, ...extra };
    for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/system/logs?${p}`;
  };

  return (
    <>
      <p className="mb-3 text-[13px] text-muted">
        Debug logging is <b className={debugOn ? "font-medium text-good" : "font-medium text-fg"}>{debugOn ? "on" : "off"}</b>
        {" · "}
        {total.toLocaleString("en-GB")} entries ({stats.counts.debug.toLocaleString("en-GB")} debug, {stats.counts.warn} warnings, {stats.counts.error} errors)
        {" · "}debug entries are kept 3 days, the rest 30 days. Entries are also written to the container output (<code className="font-mono">docker logs riparr</code>).
      </p>

      <HistoryFilters action="/system/logs" className="mb-4">
        <select name="level" aria-label="Level" className="input w-auto" defaultValue={filters.minLevel}>
          {(Object.entries(MIN_LEVELS) as [EventLevel, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="area" aria-label="Area" className="input w-auto" defaultValue={filters.component ?? ""}>
          <option value="">All areas</option>
          {(Object.entries(LOG_COMPONENTS) as [LogComponent, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="title" aria-label="Title" className="input w-auto max-w-full" defaultValue={filters.titleId ?? ""}>
          <option value="">All titles</option>
          {titles.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          type="search"
          name="q"
          aria-label="Search messages"
          placeholder="Search messages…"
          defaultValue={filters.text ?? ""}
          className="input w-full sm:w-64"
        />
        {filters.before !== undefined && (
          <Link href={query({ before: undefined })} className="link text-sm">
            Back to newest
          </Link>
        )}
      </HistoryFilters>

      {filters.minLevel === "debug" && !debugOn && stats.counts.debug === 0 && (
        <p className="mb-3 rounded-sm border border-border bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
          Debug logging is off, so there are no debug entries yet. Turn it on, reproduce the problem, then come back here.
        </p>
      )}

      {entries.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={ScrollText}
            title={filters.before !== undefined ? "Nothing older" : "No log entries match"}
            body="Try a lower level, all areas, or a different search."
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <ol className="divide-y divide-border">
            {entries.map((e) => (
              <LogRow key={e.id} entry={e} showDate={localDay(e.at) !== today} />
            ))}
          </ol>
        </div>
      )}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Link href={query({ before: entries.at(-1)!.id })} className="btn">
            Older
          </Link>
        </div>
      )}
    </>
  );
}

function LogRow({ entry: e, showDate }: { entry: LogEntry; showDate: boolean }) {
  const level = LEVELS[e.level];
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-2 text-[13px] md:grid-cols-[8.5rem_3.75rem_minmax(0,1fr)] md:px-5">
      <time dateTime={new Date(e.at).toISOString()} className="whitespace-nowrap pt-0.5 font-mono text-xs tabular-nums text-muted">
        {showDate && `${dateFmt.format(e.at)} `}
        {timeFmt.format(e.at)}
      </time>
      <span className={`h-fit w-fit rounded-xs px-1.5 py-px text-[11px] font-medium uppercase tracking-[0.04em] ${level.className}`}>{level.label}</span>
      <div className="col-span-2 min-w-0 md:col-span-1">
        <p className={`break-words ${e.level === "debug" ? "font-mono text-xs leading-5 text-fg-2" : "text-fg"}`}>{e.message}</p>
        {(e.component || e.title_id !== null) && (
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
            {e.component && <span>{LOG_COMPONENTS[e.component] ?? e.component}</span>}
            {e.title_id !== null &&
              (e.title_name ? (
                <Link href={`/titles/${e.title_id}`} className="text-accent-ink hover:underline">
                  {e.title_name}
                </Link>
              ) : (
                <span>Removed title</span>
              ))}
          </p>
        )}
      </div>
    </li>
  );
}
