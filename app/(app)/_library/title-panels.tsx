// Tab panels of the title page (server components; forms post to the title Server Actions).
import path from "node:path";
import Link from "next/link";
import { FolderOpen, Info, RefreshCw, RotateCw, TriangleAlert } from "lucide-react";
import type { DiskFile } from "@/lib/disk-scan";
import type { ExtractionRow } from "@/lib/links";
import type { SourceWithTitle } from "@/lib/sources";
import type { TitleWithStats } from "@/lib/titles";
import { Card, EmptyState, HostChip, ProgressBar, StatusPill, episodeLabel, formatAgo, formatBytes, type PillState } from "../_kit";
import { siteOf, type EpisodeRow, type FileView } from "../_data/progress";
import { redownloadEpisode, rescanTitle, retryExtractions } from "../titles/actions";
import { DeleteFileButton } from "./delete-file-button";
import { SourceActions } from "./source-actions";
import { EpisodePill, PathText, SourceDot, sourceTone } from "./ui";
import { hostLabelOf } from "./host-label";

const pct = (f: FileView) => (f.size ? Math.min(100, Math.round((f.bytes_done / f.size) * 100)) : null);

function FilePill({ file, type, now }: { file: FileView | null; type: TitleWithStats["type"]; now: number }) {
  if (!file) return <EpisodePill state="missing" now={now} />;
  return (
    <EpisodePill
      state={file.state}
      type={type}
      percent={pct(file)}
      hostLabel={hostLabelOf(file.host)}
      until={file.until}
      inFolder={file.status === "skipped"}
      now={now}
    />
  );
}

/** Why an episode is missing: no source lists it, or only on hosts Riparr can't download from. */
function missingText(unsupported: string[]) {
  return unsupported.length ? `Only on hosts Riparr can't download from: ${unsupported.join(", ")}` : "Not on any source yet";
}

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** Grid row shared by the episode and file lists: stacks on phones, columns from 860px. */
const ROW = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[44px_minmax(0,1fr)_170px_110px_80px] md:items-center md:gap-4 md:px-5";
const HEAD = "hidden border-b border-border bg-surface-2 px-5 py-2.5 text-xs font-medium text-muted md:grid md:grid-cols-[44px_minmax(0,1fr)_170px_110px_80px] md:gap-4";

/** "Download again" for an episode (or movie) deleted through Riparr. */
function RedownloadForm({ titleId, season, episode }: { titleId: number; season: number | null; episode: number | null }) {
  return (
    <form action={redownloadEpisode} className="mt-1.5">
      <input type="hidden" name="id" value={titleId} />
      <input type="hidden" name="season" value={season ?? ""} />
      <input type="hidden" name="episode" value={episode ?? ""} />
      <button className="btn h-8 min-h-0 px-2.5 text-xs">
        <RotateCw size={13} strokeWidth={1.75} aria-hidden="true" />
        Download again
      </button>
    </form>
  );
}

/** Host and size only mean something for a copy that's in the folder or on its way. */
const GONE = new Set<FileView["state"]>(["removed", "missing"]);

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
        const bytes = done.reduce((n, e) => n + (e.file?.size ?? e.disk?.size ?? 0), 0);
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
                    {e.disk ? (
                      <div className="truncate font-mono text-[11.5px] text-muted" title={e.disk.path}>
                        {baseName(e.disk.path)}
                      </div>
                    ) : (
                      <FileLine file={e.file} missingText={missingText(e.unsupported)} />
                    )}
                    {e.disk && <div className="mt-1 text-xs text-faint">In the folder, not downloaded by Riparr</div>}
                    {!e.disk && e.state !== "removed" && <Copies copies={e.copies} shown={e.file} />}
                    {e.state === "removed" && <RedownloadForm titleId={title.id} season={e.season} episode={e.episode} />}
                  </div>
                  <div>
                    {e.disk ? <EpisodePill state="done" inFolder now={now} /> : <FilePill file={e.file} type="show" now={now} />}
                  </div>
                  <div className="justify-self-end md:justify-self-start">
                    {e.file && !GONE.has(e.state) ? (
                      <HostChip host={e.file.host} />
                    ) : (
                      <span className="text-xs text-faint">{e.disk ? "Folder" : "None"}</span>
                    )}
                  </div>
                  <div className="col-span-2 text-xs tabular-nums text-muted md:col-span-1 md:text-right md:text-[13px] md:text-fg-2">
                    {e.disk ? formatBytes(e.disk.size) : e.file?.size && !GONE.has(e.state) ? formatBytes(e.file.size) : <span className="text-faint">–</span>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      {extras.length > 0 && <FilesCard titleId={title.id} title={title.type === "movie" ? "Download" : "Other files"} files={extras} type={title.type} now={now} />}
    </div>
  );
}

/** Files without an episode number: a movie's files, or packs and extras of a show. */
export function FilesCard({ titleId, title, files, type, now }: { titleId: number; title: string; files: FileView[]; type: TitleWithStats["type"]; now: number }) {
  const removed = type === "movie" && files.some((f) => f.state === "removed") && !files.some((f) => f.state === "done");
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
      {removed && (
        <div className="border-t border-border px-4 py-3 md:px-5">
          <p className="text-[13px] text-muted">Deleted from the folder; Riparr won&apos;t download it again unless you ask.</p>
          <RedownloadForm titleId={titleId} season={null} episode={null} />
        </div>
      )}
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
            <SourceActions
              source={{ id: s.id, url: s.url, poll: s.poll === 1, enabled: s.enabled === 1, poll_interval_min: s.poll_interval_min, hasPassword: Boolean(s.password) }}
              canCheck={Boolean(s.enabled && s.poll && title.monitored)}
              needsAttention={s.status === "needs_attention"}
              label={siteOf(s.url)}
            />
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
  disk,
  archives,
  freeBytes,
  now,
}: {
  title: TitleWithStats;
  files: FileView[];
  /** Every video file in the folder, by the last scan: the one record of what's on disk. */
  disk: DiskFile[];
  archives: ExtractionRow[];
  freeBytes: number | null;
  now: number;
}) {
  // Riparr's download behind each file, for its host.
  const owner = new Map(files.filter((f) => f.status === "done" && f.local_path).map((f) => [f.local_path!, f]));
  const rows = [...disk].sort((a, b) => (a.path < b.path ? -1 : 1));
  const bytes = rows.reduce((n, d) => n + d.size, 0);
  const dir = `${title.root_path}/${title.folder}`;
  const failed = archives.some((a) => a.status === "failed" || a.status === "wrong_password");
  const COLS = "md:grid-cols-[minmax(0,1fr)_70px_110px_80px_90px_40px]";
  return (
    <div className="space-y-3.5">
      <Card
        title="Files in the folder"
        action={
          <form action={rescanTitle}>
            <input type="hidden" name="id" value={title.id} />
            <button className="btn h-9 min-h-0 px-3 text-[13px]">
              <RefreshCw size={15} strokeWidth={1.75} aria-hidden="true" />
              Rescan folder
            </button>
          </form>
        }
        bodyClassName=""
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-[13px] text-muted md:px-5">
          <PathText icon={FolderOpen}>{dir}</PathText>
          <span>{title.disk_scanned_at ? `Scanned ${formatAgo(title.disk_scanned_at, now)}` : "Not scanned yet"}</span>
        </div>
        {rows.length === 0 ? (
          <div className="border-t border-border">
            <EmptyState
              icon={FolderOpen}
              title="No video files"
              body={`Downloads appear here once they're moved into ${dir}. Video files you add there yourself count too; rescan to pick them up.`}
            />
          </div>
        ) : (
          <>
            <div className={`hidden border-y border-border bg-surface-2 px-5 py-2.5 text-xs font-medium text-muted md:grid ${COLS} md:gap-4`} aria-hidden="true">
              <span>Path</span>
              <span>Episode</span>
              <span>From</span>
              <span className="text-right">Size</span>
              <span>Modified</span>
              <span />
            </div>
            <ul className="divide-y divide-border border-t border-border md:border-t-0">
              {rows.map((d) => {
                const own = owner.get(d.path);
                return (
                  <li key={d.path} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-4 py-3 ${COLS} md:items-center md:gap-4 md:px-5`}>
                    <span className="col-span-2 font-mono text-xs text-fg-2 [overflow-wrap:anywhere] md:col-span-1">{d.path.slice(dir.length + 1) || d.path}</span>
                    <span className="text-xs tabular-nums text-muted">{d.episode != null ? episodeLabel(d.season ?? 1, d.episode) : ""}</span>
                    <span>{own ? <HostChip host={own.host} /> : <span className="text-xs text-faint">Added by hand</span>}</span>
                    <span className="justify-self-end text-xs tabular-nums text-muted md:text-right md:text-[13px] md:text-fg-2">{formatBytes(d.size)}</span>
                    <span className="hidden text-xs tabular-nums text-muted md:block">{formatAgo(d.mtime, now)}</span>
                    <DeleteFileButton titleId={title.id} path={d.path} name={path.basename(d.path)} />
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="flex flex-wrap justify-between gap-3 rounded-b-md border-t border-border bg-surface-2 px-4 py-3 text-[13px] tabular-nums text-muted md:px-5">
          <span>
            {rows.length} {rows.length === 1 ? "file" : "files"} · {formatBytes(bytes)}
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
