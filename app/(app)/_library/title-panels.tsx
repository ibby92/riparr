// Tab panels of the title page (server components; forms post to the title Server Actions).
import Link from "next/link";
import { CircleAlert, CircleCheck, FolderOpen, History, Info, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import type { RiparrEvent } from "@/lib/events";
import type { ExtractionRow } from "@/lib/links";
import type { SourceWithTitle } from "@/lib/sources";
import type { TitleWithStats } from "@/lib/titles";
import { Card, EmptyState, HostChip, ProgressBar, StatusPill, episodeLabel, formatAgo, formatBytes, type PillState } from "../_kit";
import { siteOf, type EpisodeRow, type FileView } from "../_data/progress";
import { checkSourceNow, removeSource, retryExtractions, toggleSource } from "../titles/actions";
import { EpisodePill, PathText, SourceDot, sourceTone } from "./ui";
import { hostLabelOf } from "./host-label";

const pct = (f: FileView) => (f.size ? Math.min(100, Math.round((f.bytes_done / f.size) * 100)) : null);

function FilePill({ file, type, now }: { file: FileView | null; type: TitleWithStats["type"]; now: number }) {
  if (!file) return <EpisodePill state="missing" now={now} />;
  return <EpisodePill state={file.state} type={type} percent={pct(file)} hostLabel={hostLabelOf(file.host)} until={file.until} now={now} />;
}

/** Grid row shared by the episode and file lists: stacks on phones, columns from 860px. */
const ROW = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[44px_minmax(0,1fr)_170px_110px_80px] md:items-center md:gap-4 md:px-5";
const HEAD = "hidden border-b border-border bg-surface-2 px-5 py-2.5 text-xs font-medium text-muted md:grid md:grid-cols-[44px_minmax(0,1fr)_170px_110px_80px] md:gap-4";

function FileLine({ file, missingText }: { file: FileView | null; missingText: string }) {
  if (!file) return <div className="text-xs text-faint">{missingText}</div>;
  return (
    <>
      <div className="truncate font-mono text-[11.5px] text-muted" title={file.name}>{file.name}</div>
      {file.state === "downloading" && (
        <div className="mt-1.5 max-w-[260px]">
          <ProgressBar segments={[{ value: pct(file) ?? 0, tone: "done" }]} total={100} size="sm" label={`${pct(file) ?? 0}% downloaded`} />
        </div>
      )}
      {file.reason && file.state !== "standby" && file.state !== "done" && (
        <div className={`mt-1 text-xs ${file.state === "failed" ? "text-critical" : "text-muted"}`}>{file.reason}</div>
      )}
    </>
  );
}

function Copies({ copies, shown }: { copies: FileView[]; shown: FileView | null }) {
  const others = [...new Set(copies.filter((c) => c !== shown).map((c) => hostLabelOf(c.host)))];
  if (!others.length) return null;
  return <div className="mt-1 text-xs text-faint">Also on {others.join(", ")}</div>;
}

/* ------------------------------------------------------------------ episodes */

export function EpisodesPanel({ title, rows, extras, now }: { title: TitleWithStats; rows: EpisodeRow[]; extras: FileView[]; now: number }) {
  if (rows.length === 0 && extras.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={Info}
          title="No episodes found yet"
          body="Episodes appear here once a source lists their links. Add a source or check now."
        />
      </div>
    );
  }
  const seasons = new Map<number, EpisodeRow[]>();
  for (const r of rows) {
    const s = r.season ?? 1;
    seasons.set(s, [...(seasons.get(s) ?? []), r]);
  }
  return (
    <div className="space-y-3.5">
      {[...seasons.entries()].map(([season, eps]) => {
        const done = eps.filter((e) => e.state === "done");
        const bytes = done.reduce((n, e) => n + (e.file?.size ?? 0), 0);
        return (
          <Card
            key={season}
            title={`Season ${season}`}
            action={
              <span className="text-[13px] tabular-nums text-muted">
                {done.length} of {eps.length} on disk{bytes ? ` · ${formatBytes(bytes)}` : ""}
              </span>
            }
            bodyClassName=""
          >
            <div className={HEAD} aria-hidden="true">
              <span>#</span>
              <span>Episode</span>
              <span>Status</span>
              <span>Host</span>
              <span className="text-right">Size</span>
            </div>
            <ul className="divide-y divide-border">
              {eps.map((e) => (
                <li key={e.key} className={ROW}>
                  <span className="hidden text-[13px] tabular-nums text-muted md:block">{String(e.episode).padStart(2, "0")}</span>
                  <div className="col-span-2 min-w-0 md:col-span-1">
                    <div className="text-sm font-medium tabular-nums text-fg">{episodeLabel(e.season, e.episode)}</div>
                    <FileLine file={e.file} missingText="Not on any source yet" />
                    <Copies copies={e.copies} shown={e.file} />
                  </div>
                  <div>
                    <FilePill file={e.file} type="show" now={now} />
                  </div>
                  <div className="justify-self-end md:justify-self-start">{e.file ? <HostChip host={e.file.host} /> : <span className="text-xs text-faint">None</span>}</div>
                  <div className="col-span-2 text-xs tabular-nums text-muted md:col-span-1 md:text-right md:text-[13px] md:text-fg-2">
                    {e.file?.size ? formatBytes(e.file.size) : <span className="text-faint">–</span>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      {extras.length > 0 && <FilesCard title={title.type === "movie" ? "Download" : "Other files"} files={extras} type={title.type} now={now} />}
    </div>
  );
}

/** Files without an episode number: a movie's files, or packs and extras of a show. */
export function FilesCard({ title, files, type, now }: { title: string; files: FileView[]; type: TitleWithStats["type"]; now: number }) {
  const onDisk = files.filter((f) => f.state === "done");
  const bytes = onDisk.reduce((n, f) => n + (f.size ?? 0), 0);
  return (
    <Card
      title={title}
      action={<span className="text-[13px] tabular-nums text-muted">{onDisk.length ? `${formatBytes(bytes)} on disk` : "Not on disk yet"}</span>}
      bodyClassName=""
    >
      <div className={HEAD} aria-hidden="true">
        <span>#</span>
        <span>File</span>
        <span>Status</span>
        <span>Host</span>
        <span className="text-right">Size</span>
      </div>
      <ul className="divide-y divide-border">
        {files.map((f, i) => (
          <li key={f.file_id} className={ROW}>
            <span className="hidden text-[13px] tabular-nums text-muted md:block">{i + 1}</span>
            <div className="col-span-2 min-w-0 md:col-span-1">
              <FileLine file={f} missingText="" />
            </div>
            <div>
              <FilePill file={f} type={type} now={now} />
            </div>
            <div className="justify-self-end md:justify-self-start">
              <HostChip host={f.host} />
            </div>
            <div className="col-span-2 text-xs tabular-nums text-muted md:col-span-1 md:text-right md:text-[13px] md:text-fg-2">{formatBytes(f.size)}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ sources */

function sourcePill(s: SourceWithTitle): { state: PillState; label?: string } {
  if (!s.enabled) return { state: "paused", label: "Disabled" };
  if (s.status === "ok") return { state: "ok", label: "OK" };
  if (s.status === "pending") return { state: "pending", label: "Not checked yet" };
  return { state: s.status };
}

function Kv({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0 tabular-nums text-fg-2">{children}</dd>
    </>
  );
}

const small = "btn h-9 min-h-0 px-3 text-[13px]";

export function SourcesList({ title, sources, now }: { title: TitleWithStats; sources: SourceWithTitle[]; now: number }) {
  if (sources.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted md:px-5">No sources yet. Add the page or pages that list this title&apos;s links.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {sources.map((s) => {
        const pill = sourcePill(s);
        const next = !s.poll ? "Never (Click'n'Load only)" : !s.enabled ? "Disabled" : !title.monitored ? "Title is paused" : s.next_check_at <= now ? "Soon" : formatAgo(s.next_check_at, now);
        return (
          <li key={s.id} className="space-y-2.5 px-4 py-3.5 md:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-fg">
                <SourceDot tone={sourceTone(s)} label={siteOf(s.url)} />
              </span>
              <StatusPill state={pill.state} label={pill.label} />
            </div>
            <a href={s.url} target="_blank" rel="noreferrer" className="block font-mono text-xs text-fg-2 [overflow-wrap:anywhere] hover:text-accent-ink">
              {s.url}
            </a>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
              <Kv k="Reads">{s.poll ? `The page, every ${s.poll_interval_min} min` : "Click'n'Load only"}</Kv>
              <Kv k="Last check">{formatAgo(s.last_checked_at, now)}</Kv>
              <Kv k="Next check">{next}</Kv>
              <Kv k="New links">{formatAgo(s.last_changed_at, now)}</Kv>
              <Kv k="Links found">{s.link_count}</Kv>
              {s.password && <Kv k="Password">Set</Kv>}
            </dl>
            {s.last_error && (
              <p className="flex items-start gap-1.5 text-xs text-critical">
                <TriangleAlert size={13} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{s.last_error}</span>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <form action={checkSourceNow}>
                <input type="hidden" name="id" value={s.id} />
                <button className={small} disabled={!s.enabled || !s.poll || !title.monitored}>
                  <RefreshCw size={15} strokeWidth={1.75} aria-hidden="true" />
                  Check
                </button>
              </form>
              <form action={toggleSource}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="enabled" value={s.enabled ? "0" : "1"} />
                <button className={small}>{s.enabled ? "Disable" : "Enable"}</button>
              </form>
              <form action={removeSource}>
                <input type="hidden" name="id" value={s.id} />
                <button className={`${small} btn-danger`} aria-label={`Remove source ${siteOf(s.url)}`}>
                  <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                  Remove
                </button>
              </form>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Compact source health for the side of the Episodes tab. */
export function SourcesSummary({ sources, href, now }: { sources: SourceWithTitle[]; href: string; now: number }) {
  return (
    <Card
      title="Sources"
      action={
        <Link href={href} scroll={false} className="text-[13px] text-muted hover:text-fg">
          Manage
        </Link>
      }
      bodyClassName=""
    >
      {sources.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted md:px-5">No sources yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {sources.map((s) => {
            const pill = sourcePill(s);
            return (
              <li key={s.id} className="space-y-1 px-4 py-3 md:px-5">
                <div className="flex items-center justify-between gap-2 text-sm font-medium">
                  <SourceDot tone={sourceTone(s)} label={siteOf(s.url)} />
                  <StatusPill state={pill.state} label={pill.label} />
                </div>
                <p className="text-xs tabular-nums text-muted">
                  Checked {formatAgo(s.last_checked_at, now)} · {s.link_count} {s.link_count === 1 ? "link" : "links"}
                </p>
                {s.last_error && <p className="line-clamp-2 text-xs text-critical">{s.last_error}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ files */

const ARCHIVE: Record<ExtractionRow["status"], { state: PillState; label: string }> = {
  extracted: { state: "ok", label: "Extracted" },
  incomplete: { state: "pending", label: "Waiting for parts" },
  wrong_password: { state: "needs_attention", label: "Wrong password" },
  failed: { state: "error", label: "Failed" },
};

export function FilesPanel({
  title,
  files,
  archives,
  freeBytes,
  now,
}: {
  title: TitleWithStats;
  files: FileView[];
  archives: ExtractionRow[];
  freeBytes: number | null;
  now: number;
}) {
  const onDisk = files.filter((f) => f.state === "done" && f.local_path).sort((a, b) => (a.local_path! < b.local_path! ? -1 : 1));
  const bytes = onDisk.reduce((n, f) => n + (f.size ?? f.bytes_done), 0);
  const dir = `${title.root_path}/${title.folder}`;
  const failed = archives.some((a) => a.status === "failed" || a.status === "wrong_password");
  return (
    <div className="space-y-3.5">
      <Card title="Files on disk" action={<PathText icon={FolderOpen}>{dir}</PathText>} bodyClassName="">
        {onDisk.length === 0 ? (
          <EmptyState icon={FolderOpen} title="No files yet" body={`Files appear here once a download finishes and is moved into ${dir}.`} />
        ) : (
          <>
            <div className="hidden border-b border-border bg-surface-2 px-5 py-2.5 text-xs font-medium text-muted md:grid md:grid-cols-[minmax(0,1fr)_110px_80px_90px] md:gap-4" aria-hidden="true">
              <span>Path</span>
              <span>Host</span>
              <span className="text-right">Size</span>
              <span>Added</span>
            </div>
            <ul className="divide-y divide-border">
              {onDisk.map((f) => (
                <li
                  key={f.file_id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-4 py-3 md:grid-cols-[minmax(0,1fr)_110px_80px_90px] md:items-center md:gap-4 md:px-5"
                >
                  <span className="col-span-2 font-mono text-xs text-fg-2 [overflow-wrap:anywhere] md:col-span-1">{f.local_path}</span>
                  <span>
                    <HostChip host={f.host} />
                  </span>
                  <span className="justify-self-end text-xs tabular-nums text-muted md:text-right md:text-[13px] md:text-fg-2">{formatBytes(f.size ?? f.bytes_done)}</span>
                  <span className="hidden text-xs tabular-nums text-muted md:block">{formatAgo(f.updated_at, now)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="flex flex-wrap justify-between gap-3 rounded-b-md border-t border-border bg-surface-2 px-4 py-3 text-[13px] tabular-nums text-muted md:px-5">
          <span>
            {onDisk.length} {onDisk.length === 1 ? "file" : "files"} · {formatBytes(bytes)}
          </span>
          {freeBytes != null && (
            <span>
              {formatBytes(freeBytes)} free on {title.root_path}
            </span>
          )}
        </div>
      </Card>

      {archives.length > 0 && (
        <Card
          title="Archives"
          action={
            failed && (
              <form action={retryExtractions}>
                <input type="hidden" name="id" value={title.id} />
                <button className="btn h-9 min-h-0 px-3 text-[13px]">
                  <RefreshCw size={15} strokeWidth={1.75} aria-hidden="true" />
                  Retry failed
                </button>
              </form>
            )
          }
          bodyClassName=""
        >
          <ul className="divide-y divide-border">
            {archives.map((a) => (
              <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 md:px-5">
                <span className="font-mono text-xs text-fg-2 [overflow-wrap:anywhere]">{a.entry_path}</span>
                <StatusPill state={ARCHIVE[a.status].state} label={a.status === "extracted" ? `Extracted ${a.files} ${a.files === 1 ? "file" : "files"}` : ARCHIVE[a.status].label} />
                {a.error && <span className="col-span-2 text-xs text-critical">{a.error}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ history */

const LEVEL = {
  info: { icon: Info, className: "bg-surface-2 text-muted", label: "Info" },
  warn: { icon: CircleAlert, className: "bg-warn-soft text-warn", label: "Warning" },
  error: { icon: TriangleAlert, className: "bg-critical-soft text-critical", label: "Error" },
} as const;

function dayLabel(at: number, now: number) {
  const d = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export function HistoryPanel({ events, now }: { events: RiparrEvent[]; now: number }) {
  if (events.length === 0) {
    return (
      <div className="card">
        <EmptyState icon={History} title="No history yet" body="Downloads, source checks and problems for this title will be listed here." />
      </div>
    );
  }
  const days: { label: string; items: RiparrEvent[] }[] = [];
  for (const e of events) {
    const label = dayLabel(e.at, now);
    const last = days.at(-1);
    if (last?.label === label) last.items.push(e);
    else days.push({ label, items: [e] });
  }
  return (
    <div className="card overflow-hidden">
      {days.map((d) => (
        <section key={d.label}>
          <h3 className="label-caps border-b border-border bg-surface-2 px-4 py-2 md:px-5">{d.label}</h3>
          <ul className="divide-y divide-border">
            {d.items.map((e) => {
              const lvl = /^Downloaded|extracted/i.test(e.message) && e.level === "info" ? { ...LEVEL.info, icon: CircleCheck, className: "bg-good-soft text-good" } : LEVEL[e.level];
              const Icon = lvl.icon;
              return (
                <li key={e.id} className="grid grid-cols-[26px_minmax(0,1fr)] gap-x-3 px-4 py-3 md:grid-cols-[26px_minmax(0,1fr)_64px] md:px-5">
                  <span className={`grid size-[26px] place-items-center rounded-sm ${lvl.className}`}>
                    <Icon size={14} strokeWidth={2} aria-hidden="true" />
                    <span className="sr-only">{lvl.label}</span>
                  </span>
                  <span className="min-w-0 self-center break-words text-sm text-fg">{e.message}</span>
                  <time
                    dateTime={new Date(e.at).toISOString()}
                    title={new Date(e.at).toLocaleString()}
                    className="col-start-2 text-xs tabular-nums text-muted md:col-start-3 md:self-center md:text-right"
                  >
                    {new Date(e.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </time>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

