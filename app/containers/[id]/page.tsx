import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getContainer } from "@/lib/containers";
import { recentEvents } from "@/lib/events";
import { listLinks } from "@/lib/links";
import { AutoRefresh } from "../../auto-refresh";
import { LinksTable } from "../../links-table";
import { EventList, formatAgo, StatusBadge } from "../../ui";
import { checkNow, toggleContainer } from "../actions";

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

      <section className="card">
        <h2 className="border-b border-border px-4 py-2 font-medium">Activity</h2>
        <EventList events={recentEvents(50, container.id)} now={now} showContainer={false} />
      </section>
    </div>
  );
}
