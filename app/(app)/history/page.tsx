import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { History } from "lucide-react";
import { ACTIVITY_CATEGORIES, type ActivityCategory } from "@/lib/activity";
import { EmptyState, PageHeader, formatBytes } from "../_kit";
import { HISTORY_PERIODS, historyEvents, historySummary, historyTitles, type HistoryPeriod } from "../_data/history";
import { ActivityList } from "../_library/activity-list";
import { FilterChip } from "../_library/ui";
import { HistoryFilters } from "./filters";

export const metadata: Metadata = { title: "History" };

type Search = Record<string, string | string[] | undefined>;

export default function HistoryPage({ searchParams }: PageProps<"/history">) {
  return (
    <>
      <PageHeader
        title="History"
        subtitle={
          <>
            What Riparr downloaded, what changed in your library, and anything that needed you.{" "}
            <Link href="/system/logs" className="link">
              Full logs
            </Link>{" "}
            have the technical detail.
          </>
        }
      />
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <HistoryContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const PAGE_SIZE = 100;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseFilters(sp: Search) {
  const titleRaw = Number(one(sp.title));
  const show = one(sp.show);
  const periodRaw = one(sp.period);
  const beforeRaw = Number(one(sp.before));
  return {
    titleId: Number.isInteger(titleRaw) && titleRaw > 0 ? titleRaw : undefined,
    category: show && show in ACTIVITY_CATEGORIES ? (show as ActivityCategory) : undefined,
    period: (periodRaw && periodRaw in HISTORY_PERIODS ? periodRaw : "7d") as HistoryPeriod,
    before: Number.isInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : undefined,
  };
}

function Stat({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const body = (
    <>
      <span className="block font-display text-2xl leading-tight tabular-nums text-fg">{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-sm px-3 py-2 hover:bg-surface-2">
      {body}
    </Link>
  ) : (
    <div className="px-3 py-2">{body}</div>
  );
}

async function HistoryContent({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();
  const filters = parseFilters(await searchParams);
  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const { events, hasMore } = historyEvents(filters, now, PAGE_SIZE);
  const summary = historySummary(filters, now);
  const titles = historyTitles();

  const query = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const all = { show: filters.category, title: filters.titleId, period: filters.period, ...extra };
    for (const [k, v] of Object.entries(all)) if (v !== undefined) p.set(k, String(v));
    const s = p.toString();
    return s ? `/history?${s}` : "/history";
  };
  const periodLabel = HISTORY_PERIODS[filters.period].toLowerCase();

  return (
    <div className="space-y-4">
      <section className="card grid grid-cols-2 gap-1 p-2 sm:grid-cols-4" aria-label={`Summary, ${periodLabel}`}>
        <Stat label={summary.titles ? `downloaded, ${summary.titles} ${summary.titles === 1 ? "title" : "titles"}` : "downloaded"} value={summary.downloads} href={query({ show: "downloads", before: undefined })} />
        <Stat label="of data" value={formatBytes(summary.bytes)} />
        <Stat label="new links found" value={summary.linksFound} />
        <Stat label={summary.problems === 1 ? "problem" : "problems"} value={summary.problems} href={summary.problems ? query({ show: "problems", before: undefined }) : undefined} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1.5" aria-label="Show">
          <FilterChip href={query({ show: undefined, before: undefined })} active={!filters.category}>
            Everything
          </FilterChip>
          {(Object.entries(ACTIVITY_CATEGORIES) as [ActivityCategory, string][]).map(([key, label]) => (
            <FilterChip key={key} href={query({ show: key, before: undefined })} active={filters.category === key}>
              {label}
            </FilterChip>
          ))}
        </nav>
        <HistoryFilters>
          {filters.category && <input type="hidden" name="show" value={filters.category} />}
          <select name="title" aria-label="Title" className="input w-auto max-w-full" defaultValue={filters.titleId ?? ""}>
            <option value="">All titles</option>
            {titles.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select name="period" aria-label="Period" className="input w-auto" defaultValue={filters.period}>
            {(Object.entries(HISTORY_PERIODS) as [HistoryPeriod, string][]).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </HistoryFilters>
      </div>

      {filters.before !== undefined && (
        <Link href={query({ before: undefined })} className="link text-sm">
          Back to newest
        </Link>
      )}

      {events.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={History}
            title={filters.before !== undefined ? "Nothing older" : "Nothing here yet"}
            body={
              filters.category || filters.titleId !== undefined || filters.period !== "all"
                ? `Nothing matches in ${periodLabel}. Try everything, all titles, or a longer period.`
                : "Downloads, new links, changes you make and problems appear here as Riparr works."
            }
            action={
              filters.period !== "all" || filters.category ? (
                <Link href="/history?period=all" className="btn">
                  Show everything
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ActivityList events={events} now={now} />
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Link href={query({ before: events.at(-1)!.id })} className="btn">
            Older
          </Link>
        </div>
      )}
    </div>
  );
}
