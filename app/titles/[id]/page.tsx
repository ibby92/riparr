import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getContainer } from "@/lib/containers";
import { recentEvents } from "@/lib/events";
import { listExtractions, listLinks } from "@/lib/links";
import { AddLinksForm, ImportDlcForm } from "../add-links-form";
import { AutoRefresh } from "../../auto-refresh";
import { LinksTable } from "../../links-table";
import { EventList, formatAgo, StatusBadge } from "../../ui";
import { checkNow, retryExtractions, toggleContainer } from "../actions";

const ARCHIVE_STYLES = {
  extracted: "text-emerald-600 dark:text-emerald-400",
  incomplete: "text-muted",
  wrong_password: "text-amber-500",
  failed: "text-red-500",
} as const;

export default function ContainerPage({ params }: PageProps<"/containers/[id]">) {
  return (
    <Suspense fallback={<div className="card h-64 animate-pulse" />}>
      <ContainerDetail params={params} />
    </Suspense>
  );
}

async function ContainerDetail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const container = getContainer(Number((await params).id));
  if (!container) notFound();

  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const links = listLinks(container.id);
  const archives = listExtractions(container.id);
  const busy = links.some((l) => l.status === "resolving" || l.status === "downloading");
  const rows: [string, React.ReactNode][] = [
    ["URL", <a key="url" href={container.url} target="_blank" rel="noreferrer" className="break-all hover:text-accent">{container.url}</a>],
    ["Saves to", <code key="dir">{`/downloads/${container.target_dir ? container.target_dir + "/" : ""}${container.path_template}`}</code>],
    ["Poll interval", container.poll ? `${container.poll_interval_min} min` : "not polled (Click'n'Load only)"],
    ["Last check", formatAgo(container.last_checked_at, now)],
    ["Next check", !container.enabled ? "paused" : !container.poll ? "—" : container.next_check_at <= now ? "due" : formatAgo(container.next_check_at, now)],
    ["Last new content", formatAgo(container.last_changed_at, now)],
    ["Links", `${container.done_count} downloaded / ${container.link_count} found`],
  ];

  return (
    <div className="space-y-6">
      {busy && <AutoRefresh />}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{container.name}</h1>
        <StatusBadge status={container.status} enabled={container.enabled === 1} />
        <div className="ml-auto flex gap-2">
          <form action={checkNow}>
            <input type="hidden" name="id" value={container.id} />
            <button className="btn" disabled={!container.enabled || !container.poll}>Check now</button>
          </form>
          <form action={toggleContainer}>
            <input type="hidden" name="id" value={container.id} />
            <input type="hidden" name="enabled" value={container.enabled ? "0" : "1"} />
            <button className="btn">{container.enabled ? "Pause" : "Resume"}</button>
          </form>
          <Link href={`/containers/${container.id}/edit`} className="btn">Edit</Link>
        </div>
      </div>

      {container.last_error && (
        <div className="card border-red-500/40 p-4 text-sm text-red-500">{container.last_error}</div>
      )}

      <dl className="card grid gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-[max-content_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <section className="card">
        <h2 className="border-b border-border px-4 py-2 font-medium">Links</h2>
        <LinksTable links={links} now={now} empty="No links found yet. They appear here after the next check." />
      </section>

      <details className="card">
        <summary className="cursor-pointer px-4 py-2 font-medium">Add links by hand or import a .dlc</summary>
        <AddLinksForm containerId={container.id} />
        <ImportDlcForm containerId={container.id} />
      </details>

      {archives.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <h2 className="font-medium">Archives</h2>
            {archives.some((a) => a.status === "failed" || a.status === "wrong_password") && (
              <form action={retryExtractions}>
                <input type="hidden" name="id" value={container.id} />
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
        <EventList events={recentEvents(50, container.id)} now={now} showContainer={false} />
      </section>
    </div>
  );
}
