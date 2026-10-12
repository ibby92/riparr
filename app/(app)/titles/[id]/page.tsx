import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ChevronRight, FolderOpen, History, Pause, Pencil, Play, Plus, RefreshCw } from "lucide-react";
import { listExtractions, listLinks } from "@/lib/links";
import { listRootFolders } from "@/lib/root-folders";
import { listSources } from "@/lib/sources";
import { getTitle } from "@/lib/titles";
import { Card, EmptyState, Poster, StatusPill, Tag, formatBytes } from "../../_kit";
import { episodeExtras, episodeRows, hostLimits, summarize, titleFileViews } from "../../_data/progress";
import { AddSourceForm } from "../../_library/add-source-form";
import { LinksList } from "../../_library/links-list";
import { TitleSkeleton } from "../../_library/skeletons";
import { EpisodesPanel, FilesCard, FilesPanel, SourcesList, SourcesSummary } from "../../_library/title-panels";
import { ActivityList } from "../../_library/activity-list";
import { historyEvents } from "../../_data/history";
import { Note, PathText, TabLinks, TitleProgressBar, progressLabel, titlePill, titleReason } from "../../_library/ui";
import { AutoRefresh } from "../../auto-refresh";
import { AddLinksForm, ImportDlcForm } from "../add-links-form";
import { checkTitleNow, toggleTitle } from "../actions";

const TABS = ["episodes", "sources", "files", "history"] as const;
type Tab = (typeof TABS)[number];

export default function TitlePage({ params, searchParams }: PageProps<"/titles/[id]">) {
  return (
    <Suspense fallback={<TitleSkeleton />}>
      <TitleDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function TitleDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await connection();
  const title = getTitle(Number(id));
  if (!title) notFound();
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "episodes";

  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const isShow = title.type === "show";
  const sources = listSources(title.id);
  const links = listLinks(title.id);
  const files = titleFileViews(title.id, now, hostLimits(now));
  const known = episodeExtras(title.id);
  const progress = summarize(title, files, known);
  const rows = isShow ? episodeRows(title, files, known) : [];
  // Files with no episode number: a movie's files, or packs and extras of a show. Standby copies stay hidden.
  const extras = files.filter((f) => (isShow ? f.episode == null : true) && f.state !== "standby");
  const archives = listExtractions(title.id);
  const { events } = historyEvents({ titleId: title.id, period: "all" }, now, 200);
  const onDiskPaths = new Set(files.filter((f) => f.state === "done" && f.local_path).map((f) => f.local_path));
  const onDisk = onDiskPaths.size + known.disk.filter((d) => !onDiskPaths.has(d.path)).length;
  const busy = links.some((l) => l.status === "resolving" || l.status === "downloading");
  const pill = titlePill(title.status, title.type, progress);
  const reason = titleReason(title, progress, now);
  const counts = { done: 0, active: 0, waiting: 0, missing: 0 };
  for (const r of rows) {
    if (r.state === "done") counts.done++;
    else if (r.state === "downloading") counts.active++;
    else if (r.state === "waiting" || r.state === "retrying" || r.state === "queued") counts.waiting++;
    else counts.missing++;
  }
  const movieBytes = extras.reduce((n, f) => n + (f.size ?? 0), 0);
  const path = `${title.root_path}/${title.folder}`;
  const base = `/titles/${title.id}`;
  const lib = isShow ? { href: "/shows", label: "Shows" } : { href: "/movies", label: "Movies" };
  const freeBytes = tab === "files" ? (listRootFolders().find((r) => r.path === title.root_path)?.free_bytes ?? null) : null;

  return (
    <div className="space-y-[22px]">
      {busy && <AutoRefresh />}
      <div>
        <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1.5 text-[13px] text-muted">
          <Link href={lib.href} className="hover:text-fg hover:underline">
            {lib.label}
          </Link>
          <ChevronRight size={13} strokeWidth={1.75} aria-hidden="true" />
          <span className="truncate" aria-current="page">
            {title.name}
          </span>
        </nav>

        <section className="card grid grid-cols-[96px_minmax(0,1fr)] gap-4 p-4 md:grid-cols-[150px_minmax(0,1fr)] md:gap-6 md:p-5">
          <Poster
            id={title.id}
            name={title.name}
            year={title.year}
            hasPoster={Boolean(title.tmdb_id && title.poster_path)}
            className="!rounded-[10px] shadow-md md:row-span-2"
          />
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusPill state={pill.state} label={pill.label} />
              <Tag>{isShow ? "Show" : "Movie"}</Tag>
            </div>
            <h1 className="font-display text-[26px] font-medium leading-[1.05] tracking-[-0.015em] text-fg md:text-4xl">
              {title.name} {title.year && <span className="font-normal text-muted">({title.year})</span>}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
              <span>{isShow ? (title.total_episodes ? `${title.total_episodes} episodes` : "Show") : "Movie"}</span>
              <span className="text-faint" aria-hidden="true">
                ·
              </span>
              <PathText icon={FolderOpen}>{path}</PathText>
            </div>
          </div>

          <div className="col-span-2 min-w-0 space-y-4 md:col-span-1 md:col-start-2">
            {title.overview && <p className="max-w-[68ch] text-fg-2">{title.overview}</p>}
            {reason && (
              <Note tone={reason.tone}>
                <span className="text-[13px]">{reason.text}</span>
              </Note>
            )}

            <div className="grid grid-cols-2 items-center gap-x-[18px] gap-y-2 text-[13px] sm:grid-cols-[repeat(4,auto)_minmax(0,1fr)] md:justify-start">
              {isShow ? (
                <>
                  <Stat k="Downloaded" v={`${counts.done} / ${progress.total}`} />
                  <Stat k="In progress" v={counts.active} />
                  <Stat k="Waiting" v={counts.waiting} />
                  <Stat k="Missing" v={counts.missing} />
                </>
              ) : (
                <>
                  <Stat k="Status" v={progressLabel("movie", progress)} />
                  <Stat k="Size" v={movieBytes ? formatBytes(movieBytes) : "–"} />
                </>
              )}
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <TitleProgressBar type={title.type} progress={progress} size="lg" />
                <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted">
                  <Legend className="bg-accent">Downloaded</Legend>
                  <Legend className="bg-accent/45">Downloading</Legend>
                  <Legend className="bg-warn/45">Waiting</Legend>
                  <Legend className="bg-surface-3">Missing</Legend>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <form action={checkTitleNow}>
                <input type="hidden" name="id" value={title.id} />
                <button
                  className="btn btn-primary"
                  disabled={!title.monitored || sources.length === 0}
                  title={!title.monitored ? "Resume the title to check it" : sources.length === 0 ? "Add a source first" : undefined}
                >
                  <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
                  Check now
                </button>
              </form>
              <form action={toggleTitle}>
                <input type="hidden" name="id" value={title.id} />
                <input type="hidden" name="monitored" value={title.monitored ? "0" : "1"} />
                <button className="btn">
                  {title.monitored ? <Pause size={16} strokeWidth={1.75} aria-hidden="true" /> : <Play size={16} strokeWidth={1.75} aria-hidden="true" />}
                  {title.monitored ? "Pause" : "Resume"}
                </button>
              </form>
              <Link href={`${base}/edit`} className="btn">
                <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
                Edit
              </Link>
            </div>
          </div>
        </section>
      </div>

      <TabLinks
        items={[
          { href: base, label: isShow ? "Episodes" : "Download", active: tab === "episodes", count: isShow ? rows.length : undefined },
          { href: `${base}?tab=sources`, label: "Sources", active: tab === "sources", count: sources.length },
          { href: `${base}?tab=files`, label: "Files", active: tab === "files", count: onDisk },
          { href: `${base}?tab=history`, label: "History", active: tab === "history", count: events.length },
        ]}
      />

      {tab === "episodes" && (
        <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_340px]">
          {isShow ? (
            <EpisodesPanel title={title} rows={rows} extras={extras} now={now} />
          ) : extras.length ? (
            <FilesCard title="Download" files={extras} type="movie" now={now} />
          ) : known.disk.length ? (
            <Card title="Download">
              <p className="text-sm text-fg-2">
                Already in the folder, so Riparr won&apos;t download it:{" "}
                <span className="font-mono text-xs [overflow-wrap:anywhere]">{known.disk.map((d) => d.path.slice(d.path.lastIndexOf("/") + 1)).join(", ")}</span>
              </p>
            </Card>
          ) : (
            <EpisodesPanel title={title} rows={[]} extras={[]} now={now} />
          )}
          <SourcesSummary sources={sources} href={`${base}?tab=sources`} now={now} />
        </div>
      )}

      {tab === "sources" && (
        <div className="space-y-3.5">
          <Card title="Sources" bodyClassName="">
            <SourcesList title={title} sources={sources} now={now} />
          </Card>
          <Card
            title={
              <span className="inline-flex items-center gap-2">
                <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
                Add a source
              </span>
            }
          >
            <AddSourceForm titleId={title.id} />
          </Card>
          <Card title="Links" action={<span className="text-[13px] tabular-nums text-muted">{links.length} found</span>} bodyClassName="">
            <LinksList links={links} now={now} />
          </Card>
          <details className="card group">
            <summary className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md px-4 py-3 font-display text-lg font-medium text-fg md:px-5">
              <ChevronRight size={16} strokeWidth={1.75} className="text-muted transition-transform group-open:rotate-90" aria-hidden="true" />
              Add links by hand or import a .dlc
            </summary>
            <div className="border-t border-border">
              <AddLinksForm titleId={title.id} />
              <ImportDlcForm titleId={title.id} />
            </div>
          </details>
        </div>
      )}

      {tab === "files" && <FilesPanel title={title} files={files} disk={known.disk} archives={archives} freeBytes={freeBytes} now={now} />}

      {tab === "history" &&
        (events.length ? (
          <ActivityList events={events} now={now} showTitle={false} />
        ) : (
          <div className="card">
            <EmptyState icon={History} title="No history yet" body="Downloads, new links, changes you make and problems for this title will be listed here." />
          </div>
        ))}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <span>
      <span className="block text-xs text-muted">{k}</span>
      <span className="font-medium tabular-nums text-fg">{v}</span>
    </span>
  );
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={`h-1.5 w-2.5 rounded-[2px] ${className}`} aria-hidden="true" />
      {children}
    </span>
  );
}
