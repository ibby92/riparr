import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowDown, ArrowUp, FolderPlus, Gauge, HardDrive, HardDriveDownload, Layers, Plus, Tv } from "lucide-react";
import { activeLinks, totalSpeed, type LinkWithProgress } from "@/lib/links";
import { listRootFolders } from "@/lib/root-folders";
import { readDiskStatus } from "@/lib/settings";
import { listTitles } from "@/lib/titles";
import { Card, EmptyState, HostChip, PageHeader, ProgressBar, StatCard, formatBytes, formatDuration } from "./_kit";
import { downloadsByDay, weekStats } from "./_data/dashboard";
import { allTitleProgress, sourcesByTitle } from "./_data/progress";
import { DownloadsChart } from "./_library/downloads-chart";
import { TitleCard } from "./_library/title-card";
import { AutoRefresh } from "./auto-refresh";

const MAX_CARDS = 12;
// Stat grid: 2 columns on phones (last full width), 3 + 2 between 860 and 1240px, five across above.
const STAT_TOP = "grid md:col-span-2 xl:col-span-1";
const STAT_WIDE = "grid md:col-span-3 xl:col-span-1 last:col-span-2 md:last:col-span-3 xl:last:col-span-1";

export default function Dashboard() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-[22px]" aria-busy="true">
      <div className="h-10 w-56 animate-pulse rounded-sm bg-surface-3" />
      <div className="grid grid-cols-2 gap-2.5 md:gap-3.5 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="card h-28 animate-pulse" />
        ))}
      </div>
      <div className="card h-64 animate-pulse" />
    </div>
  );
}

/** "5.3 TB" → ["5.3", "TB"], for a serif value with a small unit. */
function splitBytes(n: number | null | undefined): [string, string] {
  const [v, u] = formatBytes(n).split(" ");
  return [v, u ?? ""];
}

function Delta({ now, before, period = "last 7 days" }: { now: number; before: number; period?: string }) {
  if (!before || now === before) return <span>{period}</span>;
  const up = now > before;
  const pct = Math.round((Math.abs(now - before) / before) * 100);
  return (
    <span className="flex flex-wrap items-center gap-x-1.5">
      <span className={`inline-flex items-center gap-0.5 font-medium ${up ? "text-good" : "text-critical"}`}>
        {up ? <ArrowUp size={12} strokeWidth={2.25} aria-hidden="true" /> : <ArrowDown size={12} strokeWidth={2.25} aria-hidden="true" />}
        <span className="tabular-nums">{pct}%</span>
        <span className="sr-only">{up ? "more" : "less"} than the 7 days before</span>
      </span>
      {period}
    </span>
  );
}

async function DashboardContent() {
  await connection();
  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const titles = listTitles();
  const roots = listRootFolders();
  const hour = new Date(now).getHours();
  const greeting = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const addButton = (
    <Link href="/titles/new" className="btn btn-primary">
      <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
      Add title
    </Link>
  );

  if (titles.length === 0) {
    return (
      <>
        <PageHeader title={greeting} subtitle="Your library is empty." actions={addButton} />
        <div className="card">
          {roots.length === 0 ? (
            <EmptyState
              icon={FolderPlus}
              title="Add a root folder first"
              body="Riparr files downloads under a root folder, like /media/TV. Add one in Media Management, then add your first show or movie."
              action={
                <Link href="/settings/media" className="btn btn-primary">
                  Open Media Management
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={Tv}
              title="Nothing to watch over yet"
              body="Add a show or movie and the pages that list its links. Its progress, new episodes and downloads appear here."
              action={addButton}
            />
          )}
        </div>
      </>
    );
  }

  const progress = allTitleProgress(titles, now);
  const sources = sourcesByTitle();
  const monitored = titles.filter((t) => t.monitored);
  const attention = titles.filter((t) => t.status === "needs_attention" || t.status === "error");
  const links = activeLinks();
  const downloading = links.filter((l) => l.status === "downloading" || l.status === "resolving");
  const speed = totalSpeed();
  const week = weekStats(now);
  const chart = downloadsByDay(now, 14);

  const disk = readDiskStatus();
  const lowPaths = new Set(disk?.roots.filter((r) => r.low).map((r) => r.path) ?? []);
  const known = roots.filter((r) => r.free_bytes != null);
  const free = known.reduce((n, r) => n + (r.free_bytes ?? 0), 0);
  const size = known.reduce((n, r) => n + (r.total_bytes ?? 0), 0);
  const low = roots.some((r) => lowPaths.has(r.path));
  const [freeValue, freeUnit] = splitBytes(known.length ? free : null);

  const waitingHosts = new Set([...progress.values()].flatMap((p) => (p.waitingHost ? [p.waitingHost.label] : [])));
  const summary = [
    downloading.length ? `${downloading.length} downloading` : null,
    waitingHosts.size ? `waiting on ${[...waitingHosts].join(" and ")}` : null,
    attention.length ? `${attention.length} ${attention.length === 1 ? "title needs" : "titles need"} a look` : null,
  ].filter(Boolean);

  // Needs a look first, then busy, then most recently active.
  const rank = (id: number, status: string) => {
    const p = progress.get(id);
    if (status === "needs_attention" || status === "error") return 0;
    if (p?.downloading) return 1;
    if (p?.waiting) return 2;
    return 3;
  };
  const active = [...monitored, ...attention.filter((t) => !t.monitored)]
    .sort(
      (a, b) =>
        rank(a.id, a.status) - rank(b.id, b.status) ||
        Math.max(progress.get(b.id)?.latest?.at ?? 0, b.last_changed_at ?? 0) - Math.max(progress.get(a.id)?.latest?.at ?? 0, a.last_changed_at ?? 0),
    )
    .slice(0, MAX_CARDS);
  const shows = titles.filter((t) => t.type === "show").length;
  const [dataValue, dataUnit] = splitBytes(week.current.bytes);
  const [speedValue, speedUnit] = splitBytes(speed);

  return (
    <div className="space-y-[22px]">
      {downloading.length > 0 && <AutoRefresh />}
      <PageHeader
        title={greeting}
        subtitle={summary.length ? `${summary.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()) : "All quiet. Riparr is watching your sources."}
        actions={addButton}
      />

      <section aria-label="Overview" className="grid grid-cols-2 gap-2.5 md:grid-cols-6 md:gap-3.5 xl:grid-cols-5">
        <div className={STAT_TOP}>
        <StatCard
          label="Monitored titles"
          icon={Layers}
          value={monitored.length}
          unit={`of ${titles.length}`}
          footer={
            <span className="flex flex-wrap items-center justify-between gap-1.5">
              <span>
                {shows} {shows === 1 ? "show" : "shows"} · {titles.length - shows} {titles.length - shows === 1 ? "movie" : "movies"}
              </span>
              {attention.length > 0 && (
                <Link href="/shows?status=attention" className="rounded-pill bg-critical-soft px-2 py-px font-medium text-critical">
                  {attention.length} need a look
                </Link>
              )}
            </span>
          }
        />
        </div>
        <div className={STAT_TOP}>
        <StatCard
          label="Episodes downloaded"
          icon={Tv}
          value={week.current.episodes}
          footer={
            <span className="flex flex-wrap items-center justify-between gap-1.5">
              <Delta now={week.current.episodes} before={week.previous.episodes} />
              {week.current.movies > 0 && (
                <span>
                  + {week.current.movies} {week.current.movies === 1 ? "movie" : "movies"}
                </span>
              )}
            </span>
          }
        />
        </div>
        <div className={STAT_TOP}>
        <StatCard label="Data downloaded" icon={HardDriveDownload} value={dataValue} unit={dataUnit} footer={<Delta now={week.current.bytes} before={week.previous.bytes} />} />
        </div>
        <div className={STAT_WIDE}>
        <StatCard
          label="Current speed"
          icon={Gauge}
          value={speedValue}
          unit={`${speedUnit}/s`}
          footer={downloading.length ? `${downloading.length} active ${downloading.length === 1 ? "download" : "downloads"}` : "Nothing downloading"}
        />
        </div>
        <div className={STAT_WIDE}>
        <StatCard
          label="Free space"
          icon={HardDrive}
          value={freeValue}
          unit={roots.length === 1 ? `${freeUnit} on ${roots[0].path}` : freeUnit}
          tone={low ? "warn" : undefined}
          footer={
            roots.length === 0 ? (
              <Link href="/settings/media" className="link">
                Add a root folder
              </Link>
            ) : (
              <span className="block space-y-1.5">
                {size > 0 && <ProgressBar segments={[{ value: size - free, tone: "done" }]} total={size} size="sm" label={`${Math.round(((size - free) / size) * 100)}% used`} />}
                <span className={`block ${low ? "font-medium text-warn" : ""}`}>
                  {low
                    ? "Low on space: new downloads are paused"
                    : size > 0
                      ? `${formatBytes(size - free)} of ${formatBytes(size)} used${roots.length > 1 ? ` · ${roots.length} folders` : ""}`
                      : "Folder not reachable"}
                </span>
              </span>
            )
          }
        />
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="active-titles">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="active-titles" className="font-display text-xl font-medium text-fg">
            Active titles
          </h2>
          <Link href="/shows" className="text-[13px] text-muted hover:text-fg">
            View library ({titles.length})
          </Link>
        </div>
        {active.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={Tv}
              title="Every title is paused"
              body="Resume a title in the library and Riparr starts checking its sources again."
              action={
                <Link href="/shows" className="btn">
                  Open the library
                </Link>
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 md:gap-3.5 lg:grid-cols-2 xl:grid-cols-3">
            {active.map((t) => (
              <TitleCard key={t.id} title={t} progress={progress.get(t.id)!} sources={sources.get(t.id) ?? []} now={now} />
            ))}
          </div>
        )}
      </section>

      {downloading.length > 0 && <DownloadingNow links={downloading} total={links.length} />}

      <DownloadsChart days={chart.days} hosts={chart.hosts} />
    </div>
  );
}

function DownloadingNow({ links, total }: { links: LinkWithProgress[]; total: number }) {
  return (
    <Card
      title="Downloading now"
      action={
        <Link href="/queue" className="text-[13px] text-muted hover:text-fg">
          Open queue ({total})
        </Link>
      }
      bodyClassName=""
    >
      <ul className="divide-y divide-border">
        {links.slice(0, 6).map((l) => {
          const pct = l.bytes_total ? Math.min(100, Math.round((l.bytes_done / l.bytes_total) * 100)) : null;
          const eta = l.bytes_total && l.speed_bps > 0 ? formatDuration((l.bytes_total - l.bytes_done) / l.speed_bps) : null;
          return (
            <li key={l.id} className="grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(200px,280px)] md:items-center md:px-5">
              <div className="min-w-0">
                <Link href={`/titles/${l.title_id}`} className="font-medium text-fg hover:text-accent-ink">
                  {l.title_name}
                  {l.episode && <span className="text-muted"> · {l.episode}</span>}
                </Link>
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <HostChip host={l.host} />
                  <span className="truncate font-mono text-xs text-muted" title={l.label ?? l.url}>
                    {l.label ?? l.url}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <ProgressBar segments={[{ value: pct ?? 0, tone: "done" }]} total={100} label={pct != null ? `${pct}%` : "Starting"} />
                <div className="flex justify-between gap-2 text-xs tabular-nums text-muted">
                  <span>{l.status === "resolving" ? "Starting…" : pct != null ? `${pct}% · ${formatBytes(l.bytes_done)} of ${formatBytes(l.bytes_total)}` : formatBytes(l.bytes_done)}</span>
                  {l.speed_bps > 0 && (
                    <span>
                      {formatBytes(l.speed_bps)}/s{eta && ` · ${eta} left`}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
