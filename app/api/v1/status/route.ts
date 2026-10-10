import { api } from "@/lib/api";
import { SCHEMA_VERSION } from "@/lib/db/migrations";
import { listTitles } from "@/lib/titles";
import { all } from "@/lib/db";
import { totalSpeed } from "@/lib/links";
import { hostStatuses } from "@/lib/queue";
import { HEARTBEAT_INTERVAL_MS, readDiskStatus, workerHeartbeatAge } from "@/lib/settings";
import pkg from "@/package.json";

export const GET = api(() => {
  const titles = listTitles();
  const counts = Object.fromEntries(
    all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM links GROUP BY status").map((r) => [r.status, r.n]),
  );
  const heartbeat = workerHeartbeatAge();
  const disk = readDiskStatus();
  return {
    version: pkg.version,
    worker: { online: heartbeat !== null && heartbeat < HEARTBEAT_INTERVAL_MS * 3, last_seen_ms: heartbeat },
    schema_version: SCHEMA_VERSION,
    titles: {
      total: titles.length,
      shows: titles.filter((t) => t.type === "show").length,
      movies: titles.filter((t) => t.type === "movie").length,
      monitored: titles.filter((t) => t.monitored).length,
      needs_attention: titles.filter((t) => t.status === "needs_attention").length,
      error: titles.filter((t) => t.status === "error").length,
    },
    links: {
      downloading: (counts.downloading ?? 0) + (counts.resolving ?? 0),
      queued: (counts.new ?? 0) + (counts.queued ?? 0),
      done: counts.done ?? 0,
      failed: counts.failed ?? 0,
      offline: counts.offline ?? 0,
    },
    speed_bps: totalSpeed(),
    hosts: hostStatuses().map((h) => ({
      host: h.host,
      label: h.host_label,
      state: h.state,
      until: h.until,
      reason: h.reason,
      bytes_today: h.bytesToday,
      active_downloads: h.activeDownloads,
    })),
    disk: disk && {
      low: disk.low,
      root_folders: disk.roots.map((r) => ({ path: r.path, free_bytes: r.freeBytes, total_bytes: r.totalBytes, low: r.low })),
    },
  };
});
