import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowDownToLine, Hourglass, RotateCw } from "lucide-react";
import { queueOverview, hostStatuses, type QueueItem } from "@/lib/queue";
import { getTitle } from "@/lib/titles";
import { timeZone } from "@/lib/time";
import { AutoRefresh } from "../auto-refresh";
import {
  Card,
  Countdown,
  EmptyState,
  HostChip,
  PageHeader,
  Poster,
  ProgressBar,
  StatusPill,
  SubmitButton,
  episodeLabel,
  formatAgo,
  formatBytes,
  formatDuration,
} from "../_kit";
import { retryHostNow, retryLinkNow } from "./actions";

export const metadata: Metadata = { title: "Queue" };

export default function QueuePage() {
  return (
    <>
      <PageHeader title="Queue" subtitle="Everything downloading, waiting on a host, retrying or queued." />
      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
        <Queue />
      </Suspense>
    </>
  );
}

type PosterInfo = { id: number; name: string; year: number | null; hasPoster: boolean };

/** Poster info per title, loaded once per page render. */
function posterLookup() {
  const cache = new Map<number, PosterInfo | null>();
  return (titleId: number): PosterInfo | null => {
    if (!cache.has(titleId)) {
      const t = getTitle(titleId);
      cache.set(titleId, t ? { id: t.id, name: t.name, year: t.year, hasPoster: Boolean(t.tmdb_id && t.poster_path) } : null);
    }
    return cache.get(titleId) ?? null;
  };
}

/** The file (or files) this link is about, for display. */
function fileLine(item: QueueItem) {
  if (item.files.length === 1) return item.files[0].remote_name;
  if (item.files.length > 1) return `${item.files.length} files`;
  return item.label ?? item.url;
}

function episodeOf(item: QueueItem) {
  const f = item.files.find((x) => x.episode != null);
  return (f && episodeLabel(f.season, f.episode)) ?? item.episode ?? null;
}

function Item({
  item,
  poster,
  status,
  extra,
  action,
}: {
  item: QueueItem;
  poster: PosterInfo | null;
  status: ReactNode;
  extra?: ReactNode;
  action?: ReactNode;
}) {
  const ep = episodeOf(item);
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <div className="w-10 shrink-0">
        {poster ? <Poster id={poster.id} name={poster.name} year={poster.year} hasPoster={poster.hasPoster} /> : null}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/titles/${item.title_id}`} className="font-medium text-fg hover:text-accent-ink">
            {item.title_name}
          </Link>
          {ep && <span className="text-sm tabular-nums text-muted">{ep}</span>}
          <HostChip host={item.host} />
          <span className="ml-auto">{status}</span>
        </div>
        <p className="truncate font-mono text-xs text-fg-2" title={fileLine(item)}>
          {fileLine(item)}
        </p>
        {extra}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </li>
  );
}

function RetryButton({ id, label = "Retry now" }: { id: number; label?: string }) {
  return (
    <form action={retryLinkNow}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="btn">
        <RotateCw size={15} strokeWidth={1.75} />
        <span className="hidden md:inline">{label}</span>
      </SubmitButton>
    </form>
  );
}

async function Queue() {
  await connection();
  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const q = queueOverview(now);
  const zone = timeZone();
  const hosts = hostStatuses(now);
  const all = [...q.downloading, ...q.waitingOnHost.flatMap((g) => g.items), ...q.retrying, ...q.queued, ...q.standby];
  const poster = posterLookup();
  const busy = q.downloading.length > 0;

  if (all.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={ArrowDownToLine}
          title="Nothing in the queue"
          body="New episodes appear here as soon as a source lists them, and leave once they're downloaded."
          action={
            <Link href="/history" className="btn">
              See history
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {busy && <AutoRefresh />}

      {/* Host strip: speed or cooldown per host. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {hosts.slice(0, 3).map((h) => (
          <div key={h.host} className="card flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <HostChip host={h.host} />
              <span className="ml-auto">
                {h.state === "limited" ? (
                  <StatusPill state="waiting" label="Limited" />
                ) : h.state === "errors" ? (
                  <StatusPill state="error" label="Errors" />
                ) : (
                  <StatusPill state="ok" label="OK" />
                )}
              </span>
            </div>
            <div className="font-display text-2xl tabular-nums text-fg">
              {h.state === "limited" && h.until ? <Countdown until={h.until} prefix="" done="any moment" timeZone={zone} /> : `${h.activeDownloads} active`}
            </div>
            <p className="text-xs text-muted">
              {h.state === "limited" ? h.reason : h.state === "errors" ? h.reason : `${formatBytes(h.bytesToday)} today`}
            </p>
            {h.state === "limited" && (
              <form action={retryHostNow}>
                <input type="hidden" name="host" value={h.host} />
                <SubmitButton className="btn w-full">Try {h.host_label} now</SubmitButton>
              </form>
            )}
          </div>
        ))}
      </div>

      {q.downloading.length > 0 && (
        <Card title={`Downloading (${q.downloading.length})`}>
          <ul className="divide-y divide-border">
            {q.downloading.map((item) => {
              const pct = item.bytes_total ? item.bytes_done / item.bytes_total : 0;
              const eta = item.bytes_total && item.speed_bps > 0 ? (item.bytes_total - item.bytes_done) / item.speed_bps : null;
              return (
                <Item
                  key={item.id}
                  item={item}
                  poster={poster(item.title_id)}
                 
                  status={
                    <StatusPill
                      state="downloading"
                      label={item.status === "resolving" ? "Preparing" : item.bytes_total ? `${Math.floor(pct * 100)}%` : "Downloading"}
                    />
                  }
                  extra={
                    <>
                      <ProgressBar
                        total={item.bytes_total ?? 1}
                        segments={[{ value: item.bytes_total ? item.bytes_done : 0, tone: "done" }]}
                        label={`${item.title_name} progress`}
                      />
                      <p className="text-xs tabular-nums text-muted">
                        {formatBytes(item.bytes_done)} of {formatBytes(item.bytes_total)}
                        {item.speed_bps > 0 && ` · ${formatBytes(item.speed_bps)}/s`}
                        {eta !== null && ` · ${formatDuration(eta)} left`}
                      </p>
                    </>
                  }
                />
              );
            })}
          </ul>
        </Card>
      )}

      {q.waitingOnHost.map((group) => (
        <Card
          key={group.host}
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Hourglass size={17} strokeWidth={1.75} className="text-warn" />
              Waiting on {group.host_label}
            </span>
          }
          action={
            <form action={retryHostNow}>
              <input type="hidden" name="host" value={group.host} />
              <SubmitButton className="btn">Try now</SubmitButton>
            </form>
          }
        >
          <p className="mb-3 text-sm text-fg-2">
            {group.reason}: <Countdown until={group.until} done="resuming any moment" timeZone={zone} />. Downloads pick up where they
            stopped.
          </p>
          <ul className="divide-y divide-border">
            {group.items.map((item) => (
              <Item key={item.id} item={item} poster={poster(item.title_id)} status={<StatusPill state="waiting" label="Waiting" />} />
            ))}
          </ul>
        </Card>
      ))}

      {q.retrying.length > 0 && (
        <Card title={`Retrying (${q.retrying.length})`}>
          <ul className="divide-y divide-border">
            {q.retrying.map((item) => (
              <Item
                key={item.id}
                item={item}
                poster={poster(item.title_id)}
               
                status={<StatusPill state="error" label={item.reason?.startsWith("Stalled") ? "Stalled" : "Retrying"} />}
                extra={
                  <p className="text-xs text-muted">
                    {item.reason}
                    {item.next_attempt_at && <> · next try {formatAgo(item.next_attempt_at, now)}</>}
                    {item.attempts > 0 && ` · attempt ${item.attempts} of 5`}
                  </p>
                }
                action={<RetryButton id={item.id} />}
              />
            ))}
          </ul>
        </Card>
      )}

      {q.queued.length > 0 && (
        <Card title={`Queued (${q.queued.length})`}>
          <p className="mb-3 text-sm text-muted">Waiting for a free download slot (Settings → Downloads sets how many run at once).</p>
          <ul className="divide-y divide-border">
            {q.queued.map((item) => (
              <Item key={item.id} item={item} poster={poster(item.title_id)} status={<StatusPill state="pending" label="Queued" />} />
            ))}
          </ul>
        </Card>
      )}

      {q.standby.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer px-4 py-3 font-display text-lg md:px-5">Standby copies ({q.standby.length})</summary>
          <div className="border-t border-border p-4 md:p-5">
            <p className="mb-3 text-sm text-muted">
              Another host higher in your preferred order has these files. They take over if that copy fails.
            </p>
            <ul className="divide-y divide-border">
              {q.standby.map((item) => (
                <Item key={item.id} item={item} poster={poster(item.title_id)} status={<StatusPill state="paused" label="Standby" />} />
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}
