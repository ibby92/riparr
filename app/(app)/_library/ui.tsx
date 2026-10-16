// Small presentational pieces shared by the dashboard, library and title pages (server-safe, no DB).
import type { ReactNode } from "react";
import Link from "next/link";
import { Hourglass, TriangleAlert, type LucideIcon } from "lucide-react";
import { ProgressBar, StatusPill, formatAgo, type PillState, type Segment } from "../_kit";
import type { SourceStatus, TitleStatus, TitleType } from "@/lib/titles";
import type { EpisodeState, TitleProgress } from "../_data/progress";

/* ------------------------------------------------------------------ title state */

/** The pill a title shows: its own status, refined by what its downloads are doing. */
export function titlePill(status: TitleStatus, type: TitleType, p: TitleProgress | undefined): { state: PillState; label?: string } {
  if (status === "archived") return { state: "paused", label: "Archived" };
  if (status === "paused" || status === "needs_attention" || status === "error") return { state: status };
  if (p?.downloading) return { state: "downloading" };
  if (p?.waitingHost) return { state: "waiting", label: `Waiting on ${p.waitingHost.label}` };
  if (type === "movie" && p?.movieState === "done") return { state: "downloaded" };
  if (status === "pending") return { state: "pending" };
  return { state: "ok" };
}

export function progressSegments(p: TitleProgress): Segment[] {
  return [
    { value: p.done, tone: "done" },
    { value: p.downloading, tone: "active" },
    { value: p.waiting, tone: "waiting" },
  ];
}

/** "9 / 12 episodes", or a movie's state in words. */
export function progressLabel(type: TitleType, p: TitleProgress): string {
  if (type === "show") return p.total ? `${p.done} / ${p.total} episodes` : "No episodes found yet";
  switch (p.movieState) {
    case "done":
      return "Downloaded";
    case "downloading":
      return `Downloading · ${Math.round((p.movieFraction ?? 0) * 100)}%`;
    case "waiting":
      return p.waitingHost ? `Waiting on ${p.waitingHost.label}` : "Waiting";
    case "retrying":
      return "Retrying";
    case "queued":
      return "Queued";
    case "removed":
      return "Deleted";
    default:
      return "Not downloaded";
  }
}

export function TitleProgressBar({ type, progress, size = "md" }: { type: TitleType; progress: TitleProgress; size?: "sm" | "md" | "lg" }) {
  return <ProgressBar segments={progressSegments(progress)} total={progress.total} size={size} label={progressLabel(type, progress)} />;
}

/** A one-line reason a title needs a look (or is held up), or null. */
export function titleReason(
  t: { status: TitleStatus; last_error: string | null },
  p: TitleProgress | undefined,
  now: number,
): { tone: "crit" | "warn"; text: string } | null {
  if (t.status === "paused") return null;
  if ((t.status === "needs_attention" || t.status === "error") && t.last_error) return { tone: "crit", text: t.last_error };
  if (t.status === "needs_attention") return { tone: "crit", text: "A source needs a look" };
  if (p?.waitingHost) {
    const when = p.waitingHost.until > now ? `, resumes ${formatAgo(p.waitingHost.until, now)}` : "";
    return { tone: "warn", text: `Waiting on ${p.waitingHost.label}${when}` };
  }
  return null;
}

export function Note({ tone, children }: { tone: "crit" | "warn"; children: ReactNode }) {
  const Icon = tone === "crit" ? TriangleAlert : Hourglass;
  return (
    <p className={`flex items-start gap-1.5 text-xs ${tone === "crit" ? "text-critical" : "text-warn"}`}>
      <Icon size={13} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ episodes */

export function EpisodePill({
  state,
  type = "show",
  percent,
  hostLabel,
  until,
  inFolder = false,
  now,
}: {
  state: EpisodeState;
  type?: TitleType;
  percent?: number | null;
  hostLabel?: string;
  until?: number | null;
  /** Done because the file was already in the title's folder, not downloaded. */
  inFolder?: boolean;
  now: number;
}) {
  switch (state) {
    case "done":
      return <StatusPill state={type === "movie" ? "downloaded" : "ok"} label={inFolder ? "In folder" : "Downloaded"} />;
    case "downloading":
      return <StatusPill state="downloading" label={percent != null ? `Downloading ${percent}%` : "Downloading"} />;
    case "waiting":
      return <StatusPill state="waiting" label={hostLabel ? `Waiting on ${hostLabel}` : "Waiting on host"} />;
    case "retrying":
      return <StatusPill state="waiting" label={until && until > now ? `Retrying ${formatAgo(until, now)}` : "Retrying"} />;
    case "queued":
      return <StatusPill state="pending" label="Queued" />;
    case "standby":
      return <StatusPill state="paused" label="Standby" />;
    case "failed":
      return <StatusPill state="error" label="Failed" />;
    case "removed":
      return <StatusPill state="paused" label="Deleted" />;
    default:
      return <StatusPill state="paused" label="Missing" />;
  }
}

/* ------------------------------------------------------------------ sources */

export function sourceTone(s: { enabled: number; status: SourceStatus }): "good" | "warn" | "crit" | "off" {
  if (!s.enabled) return "off";
  if (s.status === "ok") return "good";
  if (s.status === "needs_attention" || s.status === "error") return "crit";
  return "warn";
}

const DOT = { good: "bg-good", warn: "bg-warn", crit: "bg-critical", off: "border border-border-strong bg-transparent" };
const DOT_LABEL = { good: "OK", warn: "Not checked yet", crit: "Needs a look", off: "Disabled" };

export function SourceDot({ tone, label }: { tone: keyof typeof DOT; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1" title={`${label}: ${DOT_LABEL[tone]}`}>
      <span className={`size-2 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden="true" />
      <span className="truncate">{label}</span>
      <span className="sr-only">({DOT_LABEL[tone]})</span>
    </span>
  );
}

/* ------------------------------------------------------------------ navigation bits */

/** Pill-shaped filter link; the current one is filled with ink. */
export function FilterChip({ href, active, children, count }: { href: string; active: boolean; children: ReactNode; count?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 text-[13px] font-medium md:h-8 ${
        active ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface text-fg-2 hover:border-border-strong"
      }`}
    >
      {children}
      {count != null && <span className="font-normal tabular-nums opacity-70">{count}</span>}
    </Link>
  );
}

/** Segmented control made of links (grid/list, sort). */
export function SegLinks({ label, items }: { label: string; items: { href: string; active: boolean; label: string; icon?: LucideIcon; iconOnly?: boolean }[] }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-sm border border-border bg-surface-2 p-[3px]">
      {items.map(({ href, active, label: text, icon: Icon, iconOnly }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "true" : undefined}
          aria-label={iconOnly ? text : undefined}
          title={iconOnly ? text : undefined}
          className={`inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-[6px] px-2 text-[13px] font-medium ${
            active ? "bg-surface text-fg shadow-xs" : "text-muted hover:text-fg"
          }`}
        >
          {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden="true" />}
          {!iconOnly && text}
        </Link>
      ))}
    </div>
  );
}

/** Underlined tab strip of links. */
export function TabLinks({ items }: { items: { href: string; label: string; active: boolean; count?: number }[] }) {
  return (
    <nav aria-label="Sections" className="flex gap-0.5 overflow-x-auto border-b border-border [scrollbar-width:none]">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          scroll={false}
          aria-current={t.active ? "page" : undefined}
          className={`-mb-px inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 font-medium ${
            t.active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
          }`}
        >
          {t.label}
          {t.count != null && <span className="rounded-pill bg-surface-3 px-1.5 text-[11px] tabular-nums text-fg-2">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Mono folder path chip. */
export function PathText({ children, icon: Icon }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-start gap-1.5 font-mono text-xs text-fg-2">
      {Icon && <Icon size={13} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />}
      <span className="min-w-0 break-all">{children}</span>
    </span>
  );
}
