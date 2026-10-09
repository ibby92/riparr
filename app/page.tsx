import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { listContainers } from "@/lib/containers";
import { recentEvents } from "@/lib/events";
import { HEARTBEAT_INTERVAL_MS, workerHeartbeatAge } from "@/lib/settings";
import { EventList, formatAgo, StatusBadge } from "./ui";

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
        <DashboardContent />
      </Suspense>
    </div>
  );
}

async function DashboardContent() {
  await connection();
  const containers = listContainers();
  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const attention = containers.filter((c) => c.enabled && (c.status === "needs_attention" || c.status === "error"));
  const heartbeat = workerHeartbeatAge();
  const workerUp = heartbeat !== null && heartbeat < HEARTBEAT_INTERVAL_MS * 3;
  const linkTotal = containers.reduce((n, c) => n + c.link_count, 0);
  const doneTotal = containers.reduce((n, c) => n + c.done_count, 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Worker">
          <span className={workerUp ? "text-emerald-500" : "text-red-500"}>{workerUp ? "Running" : "Offline"}</span>
          {!workerUp && heartbeat !== null && (
            <span className="ml-2 text-sm text-muted">last seen {formatAgo(now - heartbeat, now)}</span>
          )}
        </Stat>
        <Stat label="Containers">
          {containers.filter((c) => c.enabled).length}
          <span className="ml-1 text-sm text-muted">watched / {containers.length}</span>
        </Stat>
        <Stat label="Links downloaded">
          {doneTotal}
          <span className="ml-1 text-sm text-muted">/ {linkTotal}</span>
        </Stat>
      </div>

      {attention.length > 0 && (
        <section className="card">
          <h2 className="border-b border-border px-4 py-2 font-medium">Needs attention</h2>
          <ul className="divide-y divide-border">
            {attention.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <StatusBadge status={c.status} />
                <Link href={`/containers/${c.id}`} className="font-medium hover:text-accent">
                  {c.name}
                </Link>
                <span className="truncate text-muted">{c.last_error}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2 className="border-b border-border px-4 py-2 font-medium">Recent activity</h2>
        <EventList events={recentEvents(25)} now={now} />
      </section>
    </>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{children}</div>
    </div>
  );
}
