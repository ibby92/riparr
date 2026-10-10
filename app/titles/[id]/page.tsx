import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { recentEvents } from "@/lib/events";
import { listExtractions, listLinks } from "@/lib/links";
import { listSources } from "@/lib/sources";
import { getTitle } from "@/lib/titles";
import { AddLinksForm, AddSourceForm, ImportDlcForm } from "../add-links-form";
import { AutoRefresh } from "../../auto-refresh";
import { LinksTable } from "../../links-table";
import { EventList, formatAgo, StatusBadge } from "../../ui";
import { checkSourceNow, checkTitleNow, removeSource, retryExtractions, toggleSource, toggleTitle } from "../actions";

const ARCHIVE_STYLES = {
  extracted: "text-emerald-600 dark:text-emerald-400",
  incomplete: "text-muted",
  wrong_password: "text-amber-500",
  failed: "text-red-500",
} as const;

export default function TitlePage({ params }: PageProps<"/titles/[id]">) {
  return (
    <Suspense fallback={<div className="card h-64 animate-pulse" />}>
      <TitleDetail params={params} />
    </Suspense>
  );
}

async function TitleDetail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const title = getTitle(Number((await params).id));
  if (!title) notFound();

  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const links = listLinks(title.id);
  const sources = listSources(title.id);
  const archives = listExtractions(title.id);
  const busy = links.some((l) => l.status === "resolving" || l.status === "downloading");
  const rows: [string, React.ReactNode][] = [
    ["Type", title.type === "show" ? "Show" : "Movie"],
    ["Folder", <code key="dir">{`${title.root_path}/${title.folder}${title.type === "show" && title.season_folders ? "/Season NN" : ""}/${title.naming}`}</code>],
    ...(title.type === "show"
      ? [["Episodes", `${title.episodes_done} downloaded${title.total_episodes ? ` of ${title.total_episodes}` : ""} · ${title.episodes_seen} found`] as [string, string]]
      : []),
    ["Links", `${title.done_count} downloaded / ${title.link_count} found`],
    ["Last new content", formatAgo(title.last_changed_at, now)],
  ];

  return (
    <div className="space-y-6">
      {busy && <AutoRefresh />}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {title.name}
          {title.year ? <span className="text-muted"> ({title.year})</span> : null}
        </h1>
        <StatusBadge status={title.status} />
        <div className="ml-auto flex gap-2">
          <form action={checkTitleNow}>
            <input type="hidden" name="id" value={title.id} />
            <button className="btn" disabled={!title.monitored || sources.length === 0}>Check now</button>
          </form>
          <form action={toggleTitle}>
            <input type="hidden" name="id" value={title.id} />
            <input type="hidden" name="monitored" value={title.monitored ? "0" : "1"} />
            <button className="btn">{title.monitored ? "Pause" : "Resume"}</button>
          </form>
          <Link href={`/titles/${title.id}/edit`} className="btn">Edit</Link>
        </div>
      </div>

      <dl className="card grid gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-[max-content_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="card">
        <h2 className="border-b border-border px-4 py-2 font-medium">Sources</h2>
        {sources.length === 0 ? (
          <p className="p-4 text-sm text-muted">No sources yet. Add the page(s) that list this title&apos;s links.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-accent" title={s.url}>
                  {s.url}
                </a>
                <StatusBadge status={s.enabled ? s.status : "paused"} />
                <span className="text-xs text-muted">
                  {s.poll ? `every ${s.poll_interval_min} min · checked ${formatAgo(s.last_checked_at, now)}` : "Click'n'Load only"} · {s.link_count} links
                </span>
                <div className="flex gap-2">
                  <form action={checkSourceNow}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className="btn" disabled={!s.enabled || !s.poll || !title.monitored}>Check</button>
                  </form>
                  <form action={toggleSource}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="enabled" value={s.enabled ? "0" : "1"} />
                    <button className="btn">{s.enabled ? "Disable" : "Enable"}</button>
                  </form>
                  <form action={removeSource}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className="btn btn-danger">Remove</button>
                  </form>
                </div>
                {s.last_error && <p className="w-full text-xs text-red-500">{s.last_error}</p>}
              </li>
            ))}
          </ul>
        )}
        <AddSourceForm titleId={title.id} />
      </section>

      <section className="card">
        <h2 className="border-b border-border px-4 py-2 font-medium">Links</h2>
        <LinksTable links={links} now={now} empty="No links found yet. They appear here after the next check." />
      </section>

      <details className="card">
        <summary className="cursor-pointer px-4 py-2 font-medium">Add links by hand or import a .dlc</summary>
        <AddLinksForm titleId={title.id} />
        <ImportDlcForm titleId={title.id} />
      </details>

      {archives.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <h2 className="font-medium">Archives</h2>
            {archives.some((a) => a.status === "failed" || a.status === "wrong_password") && (
              <form action={retryExtractions}>
                <input type="hidden" name="id" value={title.id} />
                <button className="btn">Retry failed</button>
              </form>
            )}
          </div>
          <ul className="divide-y divide-border text-sm">
            {archives.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-3 px-4 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={a.entry_path}>
                  {a.entry_path}
                </span>
                <span className={ARCHIVE_STYLES[a.status]}>
                  {a.status === "extracted" ? `extracted ${a.files} file(s)` : a.status.replace("_", " ")}
                </span>
                {a.error && <span className="w-full text-xs text-red-500">{a.error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2 className="border-b border-border px-4 py-2 font-medium">Activity</h2>
        <EventList events={recentEvents(50, title.id)} now={now} showTitle={false} />
      </section>
    </div>
  );
}
