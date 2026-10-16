// The activity feed (History page and a title's History tab): what happened, in plain words.
import type { ReactNode } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  CircleAlert,
  CircleCheck,
  FileX,
  FolderCheck,
  FolderPlus,
  HardDrive,
  Hourglass,
  Link2,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Settings2,
  Trash2,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { ACTIVITY_KINDS, type ActivityFile, type ActivityKind } from "@/lib/activity";
import { clockTime, dateTime, dayLabel as dayLabelIn } from "@/lib/time";
import { HostChip, Poster, episodeLabel, formatBytes } from "../_kit";
import type { HistoryEvent } from "../_data/history";

type Tone = "good" | "accent" | "neutral" | "warn" | "crit";

const TONE: Record<Tone, string> = {
  good: "bg-good-soft text-good",
  accent: "bg-accent-soft text-accent-ink",
  neutral: "bg-surface-3 text-fg-2",
  warn: "bg-warn-soft text-warn",
  crit: "bg-critical-soft text-critical",
};

const ICON: Record<ActivityKind, [LucideIcon, Tone]> = {
  downloaded: [ArrowDownToLine, "good"],
  in_folder: [FolderCheck, "neutral"],
  extracted: [CircleCheck, "good"],
  links_found: [Link2, "accent"],
  links_added: [Link2, "accent"],
  title_added: [Plus, "accent"],
  title_edited: [Pencil, "neutral"],
  title_deleted: [Trash2, "neutral"],
  title_paused: [Pause, "neutral"],
  title_resumed: [Play, "neutral"],
  title_archived: [Archive, "neutral"],
  title_unarchived: [ArchiveRestore, "neutral"],
  source_added: [Plus, "neutral"],
  source_changed: [Pencil, "neutral"],
  source_removed: [Trash2, "neutral"],
  source_enabled: [Play, "neutral"],
  source_disabled: [Pause, "neutral"],
  link_retried: [RotateCw, "neutral"],
  link_ignored: [XCircle, "neutral"],
  file_deleted: [Trash2, "neutral"],
  files_missing: [FileX, "warn"],
  file_requeued: [RotateCw, "neutral"],
  root_folder_added: [FolderPlus, "neutral"],
  root_folder_removed: [Trash2, "neutral"],
  settings_changed: [Settings2, "neutral"],
  needs_attention: [TriangleAlert, "warn"],
  check_failed: [TriangleAlert, "crit"],
  download_failed: [XCircle, "crit"],
  no_copy: [XCircle, "crit"],
  extract_failed: [XCircle, "crit"],
  archive_password: [CircleAlert, "warn"],
  host_limited: [Hourglass, "warn"],
  host_limit_ended: [CircleCheck, "good"],
  disk_low: [HardDrive, "warn"],
  disk_recovered: [HardDrive, "good"],
};

/** Kinds whose runs (same title, same day, back to back) are shown as one row. */
const GROUPED = new Set<ActivityKind>(["downloaded", "in_folder"]);

/** A run of downloads (or files found in the folder) of one title on one day, shown as one row. */
type Item = { lead: HistoryEvent; events: HistoryEvent[] };

// Times and days in the configured zone (lib/time.ts).
const timeFmt = { format: (at: number) => clockTime(at) };
const dayLabel = (at: number, now: number) => dayLabelIn(at, now, "long");

/** Groups by day, and folds consecutive downloads of the same title into one item. */
function group(events: HistoryEvent[], now: number) {
  const days: { label: string; items: Item[] }[] = [];
  for (const e of events) {
    const label = dayLabel(e.at, now);
    let day = days.at(-1);
    if (day?.label !== label) days.push((day = { label, items: [] }));
    const last = day.items.at(-1);
    if (last && GROUPED.has(e.kind) && e.kind === last.lead.kind && e.title_id !== null && e.title_id === last.lead.title_id) {
      last.events.push(e);
    } else {
      day.items.push({ lead: e, events: [e] });
    }
  }
  return days;
}

const fileLabel = (f: ActivityFile) => episodeLabel(f.season ?? 1, f.episode) ?? f.name;

/** "E14–E16" for a run of episodes of one season, else a short list. */
function episodeRange(files: ActivityFile[]): string | null {
  const eps = files.filter((f) => f.episode != null).sort((a, b) => (a.season ?? 1) - (b.season ?? 1) || a.episode! - b.episode!);
  if (eps.length < 2 || eps.length !== files.length) return null;
  const sameSeason = eps.every((f) => (f.season ?? 1) === (eps[0].season ?? 1));
  const contiguous = eps.every((f, i) => i === 0 || f.episode === eps[i - 1].episode! + 1);
  if (sameSeason && contiguous) return `${episodeLabel(eps[0].season ?? 1, eps[0].episode)}–E${String(eps.at(-1)!.episode).padStart(2, "0")}`;
  return eps.length <= 4 ? eps.map(fileLabel).join(", ") : null;
}

function TitleName({ e }: { e: HistoryEvent }) {
  if (e.title_id !== null && e.title_name) {
    return (
      <Link href={`/titles/${e.title_id}?tab=history`} className="font-medium text-fg hover:text-accent-ink">
        {e.title_name}
      </Link>
    );
  }
  return <span className="font-medium text-fg">{e.data.name ?? "a removed title"}</span>;
}

const host = (h: string | undefined) => (h ? <HostChip host={h} /> : null);
const siteOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return url ?? "";
  }
};

/** The sentence and detail line for an item. */
function describe(item: Item, showTitle: boolean): { text: ReactNode; meta?: ReactNode } {
  const e = item.lead;
  const d = e.data;
  const title = <TitleName e={e} />;
  const of = showTitle ? <> of {title}</> : null;
  const forTitle = showTitle ? <> for {title}</> : null;
  switch (e.kind) {
    case "downloaded": {
      const files = item.events.flatMap((x) => x.data.files ?? [{ name: "a file", season: null, episode: null, size: null }]);
      const bytes = item.events.reduce((n, x) => n + (x.data.bytes ?? 0), 0);
      const hosts = [...new Set(item.events.map((x) => x.data.host).filter(Boolean))] as string[];
      if (files.length <= 1) {
        const f = files[0];
        const what = f ? (f.episode != null ? fileLabel(f) : e.title_type === "movie" ? "the movie" : f.name) : "a file";
        return {
          text: (
            <>
              Downloaded <b className="font-medium">{what}</b>
              {of}
            </>
          ),
          meta: (
            <>
              {hosts.map((h) => (
                <HostChip key={h} host={h} />
              ))}
              {bytes > 0 && <span>{formatBytes(bytes)}</span>}
              {f && f.episode != null && <span className="truncate font-mono">{f.name}</span>}
            </>
          ),
        };
      }
      const range = episodeRange(files);
      const eps = files.every((f) => f.episode != null);
      return {
        text: (
          <>
            Downloaded{" "}
            <b className="font-medium">
              {files.length} {eps ? "episodes" : "files"}
            </b>
            {of}
            {range && <span className="text-muted"> ({range})</span>}
          </>
        ),
        meta: (
          <>
            {hosts.map((h) => (
                <HostChip key={h} host={h} />
              ))}
            {bytes > 0 && <span>{formatBytes(bytes)}</span>}
          </>
        ),
      };
    }
    case "in_folder": {
      const files = item.events.flatMap((x) => x.data.files ?? []);
      const range = episodeRange(files);
      const what =
        files.length === 1
          ? fileLabel(files[0])
          : `${files.length || "some"} ${files.length && files.every((f) => f.episode != null) ? "episodes" : "files"}`;
      return {
        text: (
          <>
            Found <b className="font-medium">{what}</b> already in the folder
            {forTitle}
            {range && <span className="text-muted"> ({range})</span>}
          </>
        ),
        meta: <span>Not downloaded again</span>,
      };
    }
    case "links_found":
      return {
        text: (
          <>
            <b className="font-medium">{d.count != null ? `${d.count} new ${d.count === 1 ? "link" : "links"}` : "New links"}</b>
            {forTitle}
          </>
        ),
        meta: d.url ? <span>on {siteOf(d.url)}</span> : undefined,
      };
    case "links_added":
      return {
        text: (
          <>
            Added <b className="font-medium">{d.count ?? "some"} {d.count === 1 ? "link" : "links"}</b>
            {forTitle}
            {d.via && <span className="text-muted"> {d.via === "hand" ? "by hand" : `from ${d.via}`}</span>}
          </>
        ),
      };
    case "extracted":
      return { text: <>Extracted an archive{forTitle}</>, meta: <span>{e.message.replace(/^Extracted /, "")}</span> };
    case "title_added":
      return { text: <>Added {title} to {e.title_type === "movie" ? "Movies" : "Shows"}</> };
    case "title_edited":
      return { text: <>Edited {title}</>, meta: d.changes?.length ? <span>Changed {d.changes.join(", ").replaceAll("_", " ")}</span> : undefined };
    case "title_deleted":
      return { text: <>Deleted <b className="font-medium">{d.name ?? "a title"}</b></>, meta: <span>Files on disk were kept</span> };
    case "title_paused":
      return { text: <>Paused {title}</> };
    case "title_resumed":
      return { text: <>Resumed {title}</> };
    case "title_archived":
      return { text: <>Archived {title}</>, meta: <span>No longer checked or downloaded; its settings, files and history are kept</span> };
    case "title_unarchived":
      return { text: <>Brought back {title} from the archive</>, meta: <span>Checking its sources again</span> };
    case "source_added":
      return { text: <>Added a source{forTitle}</>, meta: <span className="truncate font-mono">{d.url}</span> };
    case "source_changed":
      return { text: <>Replaced a source&apos;s address{forTitle}</>, meta: <span className="truncate font-mono">{d.to}</span> };
    case "source_removed":
      return { text: <>Removed a source{forTitle}</>, meta: <span className="truncate font-mono">{d.url}</span> };
    case "source_enabled":
    case "source_disabled":
      return {
        text: (
          <>
            {e.kind === "source_enabled" ? "Enabled" : "Disabled"} a source{forTitle}
          </>
        ),
        meta: <span className="truncate font-mono">{d.url}</span>,
      };
    case "link_retried":
    case "link_ignored":
      return {
        text: (
          <>
            {e.kind === "link_retried" ? "Retried" : "Ignored"} a link{forTitle}
          </>
        ),
        meta: (
          <>
            {host(d.host)}
            <span className="truncate font-mono">{d.url}</span>
          </>
        ),
      };
    case "file_deleted":
    case "files_missing":
    case "file_requeued": {
      const files = d.files ?? [];
      const range = episodeRange(files);
      const what = files.length === 1 ? fileLabel(files[0]) : `${files.length || "some"} ${files.length && files.every((f) => f.episode != null) ? "episodes" : "files"}`;
      const verb = e.kind === "file_deleted" ? "Deleted" : e.kind === "files_missing" ? "Found missing from the folder:" : "Downloading again:";
      const meta = { file_deleted: d.redownload ? "Downloading it again" : "Not downloaded again", files_missing: "Deleted outside Riparr; downloading again", file_requeued: null }[e.kind];
      // The file's own name, when the sentence shows its episode instead.
      const name = e.kind !== "file_requeued" && files.length === 1 && files[0].episode != null ? files[0].name : null;
      return {
        text: (
          <>
            {verb} <b className="font-medium">{what}</b>
            {forTitle}
            {range && <span className="text-muted"> ({range})</span>}
          </>
        ),
        meta: (
          <>
            {meta && <span>{meta}</span>}
            {name && <span className="truncate font-mono">{name}</span>}
          </>
        ),
      };
    }
    case "root_folder_added":
    case "root_folder_removed":
      return { text: <>{e.kind === "root_folder_added" ? "Added" : "Removed"} the root folder <span className="font-mono">{d.path}</span></> };
    case "settings_changed":
      return { text: <>Changed {d.section ?? ""} settings</>, meta: d.changes?.length ? <span>{d.changes.join(" · ")}</span> : undefined };
    case "needs_attention":
      return { text: <>{showTitle ? title : "This title"} needs attention</>, meta: <span>{e.message}</span> };
    case "check_failed":
      return { text: <>A source{forTitle} keeps failing</>, meta: <span>{e.message}</span> };
    case "download_failed":
      return {
        text: <>A download{forTitle} failed</>,
        meta: (
          <>
            {host(d.host)}
            <span>{e.message.replace(/^Failed: /, "")}</span>
          </>
        ),
      };
    case "no_copy":
      return {
        text: (
          <>
            No working copy of <b className="font-medium">{d.files?.[0] ? fileLabel(d.files[0]) : "a file"}</b>
            {forTitle}
          </>
        ),
        meta: <span>{e.message}</span>,
      };
    case "extract_failed":
    case "archive_password":
      return { text: <>{ACTIVITY_KINDS[e.kind].label}{forTitle}</>, meta: <span>{e.message}</span> };
    case "host_limited":
      return {
        text: <>{host(d.host)} reached a limit; its downloads are paused</>,
        meta: d.until ? <span>Resumes around {timeFmt.format(d.until)}</span> : <span>{e.message}</span>,
      };
    case "host_limit_ended":
      return { text: <>{host(d.host)} is available again; downloads resumed</> };
    case "disk_low":
      return { text: <>Low on space in <span className="font-mono">{d.path}</span></>, meta: <span>New downloads there wait until space is freed</span> };
    case "disk_recovered":
      return { text: <>Space recovered in <span className="font-mono">{d.path}</span>; downloads resumed</> };
  }
}

function ItemRow({ item, showTitle }: { item: Item; showTitle: boolean }) {
  const e = item.lead;
  const [Icon, tone] = ICON[e.kind];
  const { text, meta } = describe(item, showTitle);
  const files = item.events.length > 1 || (e.data.files?.length ?? 0) > 1 ? item.events.flatMap((x) => (x.data.files ?? []).map((f) => ({ f, host: x.data.host, at: x.at }))) : [];
  const poster = showTitle && e.title_id !== null && e.title_name;
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3 md:px-5">
      <span className={`mt-0.5 grid size-7 place-items-center rounded-sm ${TONE[tone]}`} role="img" aria-label={ACTIVITY_KINDS[e.kind].label}>
        <Icon size={14} strokeWidth={2.25} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          {poster && (
            <Link href={`/titles/${e.title_id}`} className="hidden w-7 shrink-0 sm:block" tabIndex={-1} aria-hidden="true">
              <Poster id={e.title_id!} name={e.title_name!} year={e.title_year} hasPoster={e.has_poster} className="rounded-[3px]" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm text-fg">{text}</p>
            {meta && <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">{meta}</div>}
            {files.length > 1 && (
              <details className="mt-1.5 text-xs">
                <summary className="cursor-pointer text-muted hover:text-fg">Show the {files.length} files</summary>
                <ul className="mt-1.5 space-y-1 border-l border-border pl-3">
                  {files.map(({ f, host: h, at }, i) => (
                    <li key={i} className="flex min-w-0 items-center gap-2 text-muted">
                      <span className="w-14 shrink-0 tabular-nums text-fg-2">{fileLabel(f) === f.name ? "" : fileLabel(f)}</span>
                      <span className="min-w-0 flex-1 truncate font-mono" title={f.name}>
                        {f.name}
                      </span>
                      {h && <span className="hidden sm:inline">{h}</span>}
                      {f.size != null && <span className="shrink-0 tabular-nums">{formatBytes(f.size)}</span>}
                      <span className="shrink-0 tabular-nums">{timeFmt.format(at)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      </div>
      <time dateTime={new Date(e.at).toISOString()} title={dateTime(e.at)} className="pt-1 text-xs tabular-nums text-muted">
        {item.events.length > 1 && timeFmt.format(item.events.at(-1)!.at) !== timeFmt.format(e.at)
          ? `${timeFmt.format(item.events.at(-1)!.at)}–${timeFmt.format(e.at)}`
          : timeFmt.format(e.at)}
      </time>
    </li>
  );
}

/** Activity grouped by day. `showTitle` names the title in each row (off on a title's own page). */
export function ActivityList({ events, now, showTitle = true }: { events: HistoryEvent[]; now: number; showTitle?: boolean }) {
  return (
    <div className="card">
      {group(events, now).map((day, i) => (
        <section key={`${day.label}-${i}`} aria-label={day.label}>
          <h2
            className={`label-caps sticky z-10 border-b border-border bg-surface-2 px-4 pb-2 pt-3 md:px-5 ${i === 0 ? "rounded-t-md" : "border-t"}`}
            style={{ top: "calc(4rem + env(safe-area-inset-top, 0px))" }}
          >
            {day.label}
          </h2>
          <ul className="divide-y divide-border">
            {day.items.map((item) => (
              <ItemRow key={item.lead.id} item={item} showTitle={showTitle} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
