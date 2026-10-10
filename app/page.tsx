import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { listTitles } from "@/lib/titles";
import { recentEvents } from "@/lib/events";
import { activeLinks, totalSpeed } from "@/lib/links";
import { HEARTBEAT_INTERVAL_MS, readDiskStatus, workerHeartbeatAge } from "@/lib/settings";
import { AutoRefresh } from "./auto-refresh";
import { formatBytes, LinksTable } from "./links-table";
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
  const titles = listTitles();
  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const attention = titles.filter((t) => t.status === "needs_attention" || t.status === "error");
  const heartbeat = workerHeartbeatAge();
  const workerUp = heartbeat !== null && heartbeat < HEARTBEAT_INTERVAL_MS * 3;
  const episodesDone = titles.reduce((n, t) => n + t.episodes_done, 0);
  const disk = readDiskStatus();
  const lowRoots = disk?.roots.filter((r) => r.low) ?? [];
  const freeTotal = disk?.roots.reduce((n, r) => n + (r.freeBytes ?? 0), 0) ?? null;
  const speed = totalSpeed();
  const downloading = activeLinks().filter((l) => l.status === "downloading" || l.status === "resolving");

  return (
    <>
      {downloading.length > 0 && <AutoRefresh />}
      {lowRoots.map((r) => (
        <div key={r.path} className="card border-amber-500/50 p-4 text-sm text-amber-600 dark:text-amber-400">
          Low disk space in {r.path}: {formatBytes(r.freeBytes)} free. New downloads there are paused until space is
          freed or the threshold in Settings is lowered.
        </div>
      ))}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Worker">
          <span className={workerUp ? "text-emerald-500" : "text-red-500"}>{workerUp ? "Running" : "Offline"}</span>
          {!workerUp && heartbeat !== null && (
            <span className="ml-2 text-sm text-muted">last seen {formatAgo(now - heartbeat, now)}</span>
          )}
        </Stat>
        <Stat label="Titles">
          {titles.filter((t) => t.monitored).length}
          <span className="ml-1 text-sm text-muted">monitored / {titles.length}</span>
        </Stat>
        <Stat label="Episodes downloaded">{episodesDone}</Stat>
        <Stat label="Speed">
          {formatBytes(speed)}/s
          {freeTotal !== null && <span className="ml-2 text-sm text-muted">{formatBytes(freeTotal)} free</span>}
        </Stat>
      </div>

      {downloading.length > 0 && (
        <section className="card">
          <h2 className="border-b border-border px-4 py-2 font-medium">Downloading</h2>
          <LinksTable links={downloading} now={now} showTitle />
        </section>
      )}

      {attention.length > 0 && (
        <section className="card">
          <h2 className="border-b border-border px-4 py-2 font-medium">Needs attention</h2>
          <ul className="divide-y divide-border">
            {attention.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <StatusBadge status={t.status} />
                <Link href={`/titles/${t.id}`} className="font-medium hover:text-accent">
                  {t.name}
                </Link>
                <span className="truncate text-muted">{t.last_error}</span>
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
