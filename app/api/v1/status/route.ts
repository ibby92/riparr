import { api } from "@/lib/api";
import { listContainers } from "@/lib/containers";
import { all } from "@/lib/db";
import { totalSpeed } from "@/lib/links";
import { HEARTBEAT_INTERVAL_MS, readDiskStatus, workerHeartbeatAge } from "@/lib/settings";
import pkg from "@/package.json";

export const GET = api(() => {
  const containers = listContainers();
  const counts = Object.fromEntries(
    all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM links GROUP BY status").map((r) => [r.status, r.n]),
  );
  const heartbeat = workerHeartbeatAge();
  const disk = readDiskStatus();
  return {
    version: pkg.version,
    worker: { online: heartbeat !== null && heartbeat < HEARTBEAT_INTERVAL_MS * 3, last_seen_ms: heartbeat },
    containers: {
      total: containers.length,
      enabled: containers.filter((c) => c.enabled).length,
      needs_attention: containers.filter((c) => c.enabled && c.status === "needs_attention").length,
      error: containers.filter((c) => c.enabled && c.status === "error").length,
    },
    links: {
      downloading: (counts.downloading ?? 0) + (counts.resolving ?? 0),
      queued: (counts.new ?? 0) + (counts.queued ?? 0),
      done: counts.done ?? 0,
      failed: counts.failed ?? 0,
      offline: counts.offline ?? 0,
    },
    speed_bps: totalSpeed(),
    disk: disk && { free_bytes: disk.freeBytes, total_bytes: disk.totalBytes, low: disk.low },
  };
});
