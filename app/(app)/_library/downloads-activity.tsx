import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, Poster, episodeLabel, formatBytes } from "../_kit";
import type { Arrival, DayRow, WindowStats } from "../_data/dashboard";
import { hostLabelOf } from "./host-label";

const HOST_COLOR: Record<string, string> = {
  gofile: "var(--host-gofile)",
  pixeldrain: "var(--host-pixeldrain)",
  mega: "var(--host-mega)",
};
const color = (h: string) => HOST_COLOR[h] ?? "var(--host-other)";

const GB = 1024 ** 3;
const MB = 1024 ** 2;
/** Chips shown per day before "+N more". */
const MAX_CHIPS = 6;

/** 1, 2, 2.5, 5 × 10^n at or above `v`. */
function niceStep(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const fmt = (v: number) => (v >= 100 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1));

function chipLabel(a: Arrival) {
  if (a.title_type === "movie") return "Movie";
  if (a.episode == null) return "Extra";
  return a.season && a.season > 1 ? episodeLabel(a.season, a.episode)! : `E${String(a.episode).padStart(2, "0")}`;
}

function Chip({ a }: { a: Arrival }) {
  const ep = a.episode != null ? ` ${episodeLabel(a.season ?? 1, a.episode)}` : "";
  return (
    <Link
      href={`/titles/${a.title_id}`}
      title={`${a.title_name}${ep}\n${a.name}\n${formatBytes(a.size)} from ${hostLabelOf(a.host)}`}
      className="grid grid-cols-[minmax(0,1fr)] items-center gap-1.5 rounded-xs md:grid-cols-[16px_minmax(0,1fr)] border-l-[3px] bg-surface px-1 py-[3px] text-[11px] tabular-nums text-fg-2 hover:bg-surface-3 hover:text-fg"
      style={{ borderLeftColor: color(a.host) }}
    >
      <Poster id={a.title_id} name={a.title_name} year={a.year} hasPoster={a.has_poster} className="w-4 rounded-[2px] max-md:hidden" />
      <span className="truncate">{chipLabel(a)}</span>
    </Link>
  );
}

/** The 14-day transfer line with "this week" marked; labels in HTML so they don't stretch with the plot. */
function TrendLine({ days }: { days: DayRow[] }) {
  const max = Math.max(0, ...days.map((d) => d.total));
  const [unit, div] = max >= GB ? ["GB", GB] : ["MB", MB];
  const step = max > 0 ? niceStep(max / div / 3) : 1;
  const top = max > 0 ? Math.ceil(max / div / step) * step : 3;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const x = (i: number) => (i / (days.length - 1)) * 100;
  const y = (bytes: number) => 100 - (bytes / div / top) * 100;
  const line = days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(d.total).toFixed(2)}`).join(" ");
  const area = `${line} L100,100 L0,100 Z`;
  const split = x(days.length - 7.5);
  const last = days[days.length - 1];
  const labelled = [0, Math.round((days.length - 1) / 3), Math.round(((days.length - 1) * 2) / 3), days.length - 1];

  return (
    <div className="flex min-w-0 gap-2">
      <div className="relative h-[150px] w-9 shrink-0 text-right text-[11px] tabular-nums text-muted" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(t * div)}%` }}>
            {fmt(t)}
            {t === top ? ` ${unit}` : ""}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-[150px]">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
            role="img"
            aria-label={`Data transferred per day over the last ${days.length} days: ${formatBytes(last.total)} today.`}
          >
            <defs>
              <linearGradient id="trend-fade" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--accent)" stopOpacity="0.26" />
                <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <line key={t} x1="0" x2="100" y1={y(t * div)} y2={y(t * div)} vectorEffect="non-scaling-stroke" style={{ stroke: t === 0 ? "var(--border-strong)" : "var(--grid)" }} />
            ))}
            <line x1={split} x2={split} y1="0" y2="100" vectorEffect="non-scaling-stroke" strokeDasharray="3 4" style={{ stroke: "var(--border-strong)" }} />
            <path d={area} fill="url(#trend-fade)" />
            <path d={line} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={2.25} strokeLinejoin="round" style={{ stroke: "var(--accent)" }} />
          </svg>
          <span className="absolute -translate-y-full pl-1.5 text-[11px] text-muted" style={{ left: `${split}%`, top: 12 }} aria-hidden="true">
            this week
          </span>
          <span
            className="absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent"
            style={{ left: "100%", top: `${y(last.total)}%` }}
            aria-hidden="true"
          />
          <span
            className="absolute right-2 -translate-y-[calc(100%+8px)] whitespace-nowrap text-[11px] font-medium tabular-nums text-fg"
            style={{ top: `${Math.max(14, y(last.total))}%` }}
            aria-hidden="true"
          >
            {formatBytes(last.total)} today
          </span>
        </div>
        <div className="relative mt-1.5 h-4 text-[11px] text-muted" aria-hidden="true">
          {labelled.map((i, k) => (
            <span
              key={i}
              className={`absolute whitespace-nowrap ${k === 0 ? "" : k === labelled.length - 1 ? "-translate-x-full font-medium text-fg" : "-translate-x-1/2"}`}
              style={{ left: `${x(i)}%` }}
            >
              {days[i].label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Downloads over the last 14 days: a summary of this week (data transferred,
 * change against the week before, host share) with a trend line, and an
 * arrivals strip of the episodes that finished each day.
 */
export function DownloadsActivity({ days, hosts, week }: { days: DayRow[]; hosts: string[]; week: { current: WindowStats; previous: WindowStats } }) {
  const thisWeek = days.slice(-7);
  const bytes = week.current.bytes;
  const before = week.previous.bytes;
  const change = before > 0 && bytes !== before ? Math.round(((bytes - before) / before) * 100) : null;
  const byHost = hosts
    .map((h) => ({ host: h, bytes: thisWeek.reduce((n, d) => n + (d.byHost[h] ?? 0), 0) }))
    .filter((h) => h.bytes > 0);
  const weekArrivals = thisWeek.flatMap((d) => d.arrivals);
  const titles = new Set(weekArrivals.map((a) => a.title_id)).size;
  const busiest = thisWeek.reduce((a, b) => (b.total > a.total ? b : a));
  const [value, unit] = formatBytes(bytes).split(" ");
  const quiet = days.every((d) => d.total === 0 && d.arrivals.length === 0);

  return (
    <Card
      title="Downloads"
      action={
        <Link href="/history" className="text-[13px] text-muted hover:text-fg">
          History
        </Link>
      }
      bodyClassName=""
    >
      <div className="grid gap-6 border-b border-border p-4 md:p-5 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:items-center">
        <div>
          <div className="text-xs text-muted">Last 7 days</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-display text-[2.75rem] leading-none tabular-nums text-fg">{value}</span>
            <span className="text-sm text-muted">{unit}</span>
            {change !== null && (
              <span
                className={`inline-flex items-center gap-0.5 rounded-pill px-2 py-0.5 text-xs font-medium tabular-nums ${change > 0 ? "bg-good-soft text-good" : "bg-surface-3 text-muted"}`}
              >
                {change > 0 ? <ArrowUp size={12} strokeWidth={2.25} aria-hidden="true" /> : <ArrowDown size={12} strokeWidth={2.25} aria-hidden="true" />}
                {Math.abs(change)}% vs the week before
              </span>
            )}
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-x-5 text-[13px] text-muted">
            <div>
              <dd className="text-base font-medium tabular-nums text-fg">{week.current.episodes + week.current.movies}</dd>
              <dt>{week.current.movies ? "downloads" : "episodes"}</dt>
            </div>
            <div>
              <dd className="text-base font-medium tabular-nums text-fg">{titles}</dd>
              <dt>{titles === 1 ? "title" : "titles"}</dt>
            </div>
            <div>
              <dd className="truncate text-base font-medium text-fg">{busiest.total > 0 ? busiest.label : "–"}</dd>
              <dt>busiest</dt>
            </div>
          </dl>
          {byHost.length > 0 && (
            <>
              <div
                className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-xs"
                role="img"
                aria-label={`By host: ${byHost.map((h) => `${hostLabelOf(h.host)} ${formatBytes(h.bytes)}`).join(", ")}`}
              >
                {byHost.map((h) => (
                  <i key={h.host} className="block" style={{ flexGrow: h.bytes, background: color(h.host) }} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-fg-2">
                {byHost.map((h) => (
                  <span key={h.host} className="inline-flex items-center gap-1.5">
                    <i className="size-2.5 rounded-[3px]" style={{ background: color(h.host) }} aria-hidden="true" />
                    {hostLabelOf(h.host)} <b className="font-medium tabular-nums text-fg">{formatBytes(h.bytes)}</b>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
        <TrendLine days={days} />
      </div>

      <div className="p-4 md:p-5">
        {quiet ? (
          <p className="py-6 text-center text-sm text-muted">Nothing downloaded in the last {days.length} days.</p>
        ) : (
          <div className="pb-1 md:overflow-x-auto">
            {/* Phones show the last 7 days, which fit without scrolling; wider screens all 14. */}
            <ol
              className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 md:min-w-[860px] md:grid-cols-[repeat(14,minmax(0,1fr))] md:gap-1.5"
              aria-label="Episodes that finished each day"
            >
              {days.map((d, i) => {
                const today = i === days.length - 1;
                const extra = d.arrivals.length - MAX_CHIPS;
                return (
                  <li
                    key={d.key}
                    className={`grid min-h-[168px] min-w-0 grid-rows-[auto_1fr_auto] gap-1.5 rounded-sm px-1 py-2 md:px-1.5 ${i < days.length - 7 ? "max-md:hidden" : ""} ${today ? "bg-accent-soft outline outline-1 outline-accent" : "bg-surface-2"}`}
                  >
                    <div className={`text-center text-xs ${today ? "font-semibold text-accent-ink" : "text-muted"}`}>{d.label}</div>
                    <div className="flex flex-col gap-1">
                      {d.arrivals.slice(0, extra > 0 ? MAX_CHIPS - 1 : MAX_CHIPS).map((a) => (
                        <Chip key={a.file_id} a={a} />
                      ))}
                      {extra > 0 && (
                        <span
                          className="px-1 text-[11px] text-muted"
                          title={d.arrivals.slice(MAX_CHIPS - 1).map((a) => `${a.title_name} ${chipLabel(a)}`).join("\n")}
                        >
                          +{extra + 1} more
                        </span>
                      )}
                    </div>
                    <div className="text-center text-[11px] tabular-nums text-muted" title={`${formatBytes(d.total)} transferred`}>
                      {d.total ? formatBytes(d.total) : "–"}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          Chips are episodes that finished, edged in their host&apos;s colour. Totals are data transferred from hosts, including retries and titles deleted since.
        </p>
      </div>
    </Card>
  );
}
