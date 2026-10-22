import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Hourglass, Loader, Pause, TriangleAlert, type LucideIcon } from "lucide-react";

export { Countdown } from "./countdown";
export { Poster } from "./poster";
export { SubmitButton } from "./submit-button";
export * from "./format";

/* ------------------------------------------------------------------ layout */

/** Page title (serif), optional subtitle, and right-aligned actions that wrap on phones. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-2xl font-medium leading-tight text-fg md:text-[30px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A white card; `title` adds a header row with an optional action on the right. */
export function Card({
  title,
  action,
  children,
  className = "",
  bodyClassName = "p-4 md:p-5",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`card min-w-0 ${className}`}>
      {title && (
        <header className="flex items-center gap-3 border-b border-border px-4 py-3 md:px-5">
          <h2 className="font-display text-lg font-medium text-fg">{title}</h2>
          {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Big-number tile: label + icon well, serif value with a small unit, and an optional footer. */
export function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  footer,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  icon?: LucideIcon;
  footer?: ReactNode;
  tone?: "good" | "warn" | "critical";
}) {
  const toneClass = tone === "warn" ? "text-warn" : tone === "critical" ? "text-critical" : tone === "good" ? "text-good" : "text-fg";
  return (
    <div className="card flex min-w-0 flex-col gap-3 p-4 md:p-5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-fg-2">{label}</span>
        {Icon && (
          <span className="ml-auto grid size-8 place-items-center rounded-sm bg-surface-2 text-muted">
            <Icon size={16} strokeWidth={1.75} />
          </span>
        )}
      </div>
      <div className={`font-display text-[30px] leading-none tabular-nums ${toneClass}`}>
        {value}
        {unit && <small className="ml-1 font-sans text-sm text-muted">{unit}</small>}
      </div>
      {footer && <div className="text-xs text-muted">{footer}</div>}
    </div>
  );
}

/** Dashed icon well, serif one-liner, one sentence, and one action. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <span className="grid size-14 place-items-center rounded-md border border-dashed border-border-strong text-faint">
        <Icon size={24} strokeWidth={1.5} />
      </span>
      <p className="font-display text-xl text-fg">{title}</p>
      {body && <p className="max-w-md text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ status */

export type PillState = "ok" | "waiting" | "needs_attention" | "error" | "paused" | "pending" | "downloaded" | "downloading";

const PILLS: Record<PillState, { label: string; icon: LucideIcon; className: string }> = {
  ok: { label: "Healthy", icon: CircleCheck, className: "bg-good-soft text-good" },
  waiting: { label: "Waiting on host", icon: Hourglass, className: "bg-warn-soft text-warn" },
  needs_attention: { label: "Needs attention", icon: TriangleAlert, className: "bg-critical-soft text-critical" },
  error: { label: "Error", icon: CircleAlert, className: "bg-critical-soft text-critical" },
  paused: { label: "Paused", icon: Pause, className: "border border-border-strong text-paused" },
  pending: { label: "Checking", icon: Loader, className: "bg-surface-3 text-muted" },
  downloaded: { label: "Downloaded", icon: CircleCheck, className: "bg-info-soft text-info" },
  downloading: { label: "Downloading", icon: Loader, className: "bg-accent-soft text-accent-ink" },
};

/** State pill: icon + label + tint (never colour alone). `label` overrides the default text. */
export function StatusPill({ state, label }: { state: PillState; label?: string }) {
  const { label: text, icon: Icon, className } = PILLS[state];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-pill px-2 py-0.5 text-xs font-medium ${className}`}>
      <Icon size={12} strokeWidth={2.25} aria-hidden="true" />
      {label ?? text}
    </span>
  );
}

/** Small uppercase type tag: SHOW, MOVIE. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-xs border border-border px-1.5 py-px text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted">
      {children}
    </span>
  );
}

const HOSTS: Record<string, { label: string; color: string }> = {
  gofile: { label: "gofile", color: "var(--host-gofile)" },
  pixeldrain: { label: "pixeldrain", color: "var(--host-pixeldrain)" },
  mega: { label: "MEGA", color: "var(--host-mega)" },
};

/** Host identity: colour swatch + name (unknown hosts get the neutral swatch and their domain). */
export function HostChip({ host }: { host: string }) {
  const h = HOSTS[host] ?? { label: host, color: "var(--host-other)" };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xs bg-surface-2 px-1.5 py-0.5 text-xs text-fg-2">
      <span className="size-2 rounded-[2px]" style={{ background: h.color }} aria-hidden="true" />
      {h.label}
    </span>
  );
}

export type Segment = { value: number; tone: "done" | "active" | "waiting" };

/** Segmented bar: done (accent), active (faded accent), waiting (faded warn) out of `total`. */
export function ProgressBar({
  segments,
  total,
  size = "md",
  label,
}: {
  segments: Segment[];
  total: number;
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const height = size === "sm" ? "h-1" : size === "lg" ? "h-2" : "h-1.5";
  const tones = { done: "bg-accent", active: "bg-accent/45", waiting: "bg-warn/45" };
  const done = segments.find((s) => s.tone === "done")?.value ?? 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total || 1}
      aria-valuenow={done}
      className={`flex w-full gap-0.5 overflow-hidden rounded-xs bg-surface-3 ${height}`}
    >
      {total > 0 &&
        segments
          .filter((s) => s.value > 0)
          .map((s, i) => <span key={i} className={tones[s.tone]} style={{ width: `${Math.min(100, (s.value / total) * 100)}%` }} />)}
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

/** Label + control + error/hint. */
export function Field({
  label,
  hint,
  errors,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  errors?: string[];
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-fg-2">
        {label}
      </label>
      {children}
      {errors?.length ? (
        errors.map((e) => (
          <p key={e} className="text-xs text-critical">
            {e}
          </p>
        ))
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** Settings-style row: label and hint on the left, a native checkbox styled as a switch on the right. */
export function SwitchRow({
  name,
  label,
  hint,
  defaultChecked,
  id,
}: {
  name: string;
  label: string;
  hint?: ReactNode;
  defaultChecked?: boolean;
  id?: string;
}) {
  const inputId = id ?? `switch-${name}`;
  return (
    <div className="flex items-start gap-4 py-2">
      <label htmlFor={inputId} className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </label>
      <input
        id={inputId}
        name={name}
        type="checkbox"
        role="switch"
        defaultChecked={defaultChecked}
        className="relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-pill bg-border-strong transition-colors before:absolute before:left-0.5 before:top-0.5 before:size-4 before:rounded-full before:bg-surface before:shadow-xs before:transition-transform checked:bg-accent checked:before:translate-x-4"
      />
    </div>
  );
}
