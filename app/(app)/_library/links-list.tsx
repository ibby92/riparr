import type { LinkStatus, LinkWithProgress } from "@/lib/links";
import { HostChip, ProgressBar, StatusPill, SubmitButton, formatAgo, formatBytes, formatDuration, type PillState } from "../_kit";
import { ignoreLink, retryLink } from "../titles/actions";

/** Queued with nothing left to fetch itself: every remaining file waits on a preferred host. */
function isStandby(l: LinkWithProgress) {
  return l.status === "queued" && l.files_standby > 0 && l.files_standby + l.files_done === l.file_count;
}

const RETRYABLE: LinkStatus[] = ["failed", "offline", "ignored", "queued"];
const IGNORABLE: LinkStatus[] = ["new", "queued", "resolving", "downloading", "failed", "offline"];

function linkPill(l: LinkWithProgress, now: number): { state: PillState; label: string } {
  if (isStandby(l)) return { state: "paused", label: "Standby" };
  switch (l.status) {
    case "new":
      return { state: "pending", label: "Found" };
    case "queued":
      return l.retry_at && l.retry_at > now ? { state: "waiting", label: `Retrying ${formatAgo(l.retry_at, now)}` } : { state: "pending", label: "Queued" };
    case "resolving":
      return { state: "downloading", label: "Opening" };
    case "downloading":
      return { state: "downloading", label: "Downloading" };
    case "done":
      return { state: "ok", label: "Downloaded" };
    case "mirror":
      return { state: "ok", label: "Got from another host" };
    case "failed":
      return { state: "error", label: "Failed" };
    case "offline":
      return { state: "needs_attention", label: "Offline" };
    case "ignored":
      return { state: "paused", label: "Ignored" };
  }
}

/** Every link a title's sources listed, with progress and Retry/Ignore. Stacks on phones. */
export function LinksList({ links, now }: { links: LinkWithProgress[]; now: number }) {
  if (links.length === 0) return <p className="px-4 py-6 text-center text-sm text-muted md:px-5">No links found yet. They appear here after the next check.</p>;
  return (
    <ul className="divide-y divide-border">
      {links.map((l) => {
        const pill = linkPill(l, now);
        const pct = l.bytes_total ? Math.min(100, (l.bytes_done / l.bytes_total) * 100) : null;
        const standby = isStandby(l);
        return (
          <li key={l.id} className="grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_200px_auto] md:items-center md:px-5">
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <HostChip host={l.host} />
                <a href={l.url} target="_blank" rel="noreferrer" className="truncate font-mono text-xs text-fg-2 hover:text-accent-ink" title={l.url}>
                  {l.label ?? l.url}
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <StatusPill state={pill.state} label={pill.label} />
                {[l.episode, l.quality, l.size_text].filter(Boolean).map((v) => (
                  <span key={v} className="rounded-xs border border-border px-1.5">
                    {v}
                  </span>
                ))}
              </div>
              {l.error && l.status !== "done" && <p className={`text-xs ${l.status === "ignored" ? "text-muted" : "text-critical"}`}>{l.error}</p>}
            </div>
            <div className="min-w-0">
              {l.file_count > 0 && (
                <div className="space-y-1">
                  <ProgressBar segments={[{ value: pct ?? 0, tone: "done" }]} total={100} size="sm" label={pct != null ? `${Math.round(pct)}% downloaded` : "Progress unknown"} />
                  <div className="text-xs tabular-nums text-muted">
                    {formatBytes(l.bytes_done)} / {formatBytes(l.bytes_total)}
                    {l.file_count > 1 && ` · ${l.files_done}/${l.file_count} files`}
                    {l.files_standby > 0 && ` · ${l.files_standby} on standby`}
                    {l.status === "downloading" && l.speed_bps > 0 && (
                      <>
                        {` · ${formatBytes(l.speed_bps)}/s`}
                        {l.bytes_total !== null && ` · ${formatDuration((l.bytes_total - l.bytes_done) / l.speed_bps)} left`}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 md:justify-end">
              {RETRYABLE.includes(l.status) && !standby && (
                <form action={retryLink}>
                  <input type="hidden" name="id" value={l.id} />
                  <SubmitButton className="btn h-9 min-h-0 px-3 text-[13px]">{l.status === "queued" ? "Retry now" : "Retry"}</SubmitButton>
                </form>
              )}
              {IGNORABLE.includes(l.status) && (
                <form action={ignoreLink}>
                  <input type="hidden" name="id" value={l.id} />
                  <SubmitButton className="btn btn-ghost h-9 min-h-0 px-3 text-[13px]">Ignore</SubmitButton>
                </form>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
