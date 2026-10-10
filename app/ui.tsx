import type { TitleStatus } from "@/lib/titles";
import type { EventLevel, RiparrEvent } from "@/lib/events";

export function formatAgo(ts: number | null, now = Date.now()): string {
  if (!ts) return "never";
  const diff = now - ts;
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  const [value, unit] =
    s < 60 ? [s, "s"] : s < 3600 ? [s / 60, "m"] : s < 86400 ? [s / 3600, "h"] : [s / 86400, "d"];
  const text = `${Math.max(1, Math.floor(value))}${unit}`;
  return future ? `in ${text}` : `${text} ago`;
}

const STATUS_STYLES: Record<TitleStatus, [string, string]> = {
  pending: ["Pending", "bg-zinc-500/15 text-muted"],
  ok: ["OK", "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"],
  needs_attention: ["Needs attention", "bg-amber-500/15 text-amber-600 dark:text-amber-400"],
  error: ["Error", "bg-red-500/15 text-red-600 dark:text-red-400"],
  paused: ["Paused", "bg-zinc-500/15 text-muted"],
};

export function StatusBadge({ status }: { status: TitleStatus }) {
  const [label, style] = STATUS_STYLES[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}

const LEVEL_STYLES: Record<EventLevel, string> = {
  info: "text-muted",
  warn: "text-amber-500",
  error: "text-red-500",
};

export function EventList({
  events,
  now,
  showTitle = true,
}: {
  events: RiparrEvent[];
  now: number;
  showTitle?: boolean;
}) {
  if (events.length === 0) return <p className="p-4 text-sm text-muted">No activity yet.</p>;
  return (
    <ul className="divide-y divide-border text-sm">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 px-4 py-2">
          <span className="w-16 shrink-0 text-muted" title={new Date(e.at).toLocaleString()}>
            {formatAgo(e.at, now)}
          </span>
          <span className={`w-10 shrink-0 uppercase ${LEVEL_STYLES[e.level]}`}>{e.level}</span>
          <span className="min-w-0 break-words">
            {showTitle && e.title_name && <span className="font-medium">{e.title_name}: </span>}
            {e.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
