import fs from "node:fs";
import { logDebug, logEvent, logThrottled } from "@/lib/events";
import { notify } from "@/lib/notify";
import { listRootFolders } from "@/lib/root-folders";
import { getSettings, writeDiskStatus } from "@/lib/settings";

const CHECK_EVERY_MS = 30_000;
const GB = 1024 ** 3;

type RootState = { checkedAt: number; low: boolean; freeBytes: number | null; totalBytes: number | null };
const roots = new Map<string, RootState>();

/**
 * True while `rootPath` has less free space than the configured floor, so new
 * downloads into it wait. Re-checked at most every 30 s per root; logs and
 * notifies once per low-space episode. Also publishes every root folder's
 * space for the dashboard.
 */
export function diskIsLow(rootPath: string, now = Date.now()): boolean {
  const known = roots.get(rootPath);
  if (known && now - known.checkedAt < CHECK_EVERY_MS) return known.low;

  let freeBytes: number | null = null;
  let totalBytes: number | null = null;
  try {
    const stats = fs.statfsSync(rootPath);
    freeBytes = stats.bavail * stats.bsize;
    totalBytes = stats.blocks * stats.bsize;
  } catch (err) {
    // Every 30 s while it lasts; once every 10 minutes in the log is plenty.
    logThrottled(`disk:${rootPath}`, 10 * 60_000, "warn", `Can't read free space of ${rootPath}: ${err instanceof Error ? err.message : String(err)}`, null, "disk");
  }

  const minFree = getSettings().minFreeGb * GB;
  const low = freeBytes !== null && minFree > 0 && freeBytes < minFree;
  if (low && !known?.low) {
    const message = `Only ${(freeBytes! / GB).toFixed(1)} GB free in ${rootPath}; new downloads there are paused`;
    logEvent("warn", message, null, "disk", { kind: "disk_low", data: { path: rootPath, bytes: freeBytes! } });
    void notify({ event: "needs_attention", message });
  } else if (!low && known?.low) {
    logEvent("info", `Free space recovered in ${rootPath}; downloads resumed`, null, "disk", { kind: "disk_recovered", data: { path: rootPath } });
  }
  if (!known) logDebug("disk", () => `${rootPath}: ${freeBytes === null ? "free space unknown" : `${(freeBytes / GB).toFixed(1)} GB free`}, floor ${getSettings().minFreeGb} GB`);
  roots.set(rootPath, { checkedAt: now, low, freeBytes, totalBytes });
  publish(now);
  return low;
}

/** Checks every root folder (so the dashboard has numbers even when nothing is downloading). */
export function checkAllRoots(now = Date.now()) {
  for (const r of listRootFolders()) diskIsLow(r.path, now);
}

function publish(now: number) {
  const list = [...roots.entries()].map(([path, r]) => ({
    path,
    freeBytes: r.freeBytes,
    totalBytes: r.totalBytes,
    low: r.low,
  }));
  writeDiskStatus({ roots: list, low: list.some((r) => r.low), checkedAt: now });
}

/** Forgets cached checks so the next call re-checks (tests). */
export function resetDiskCheck() {
  roots.clear();
}
