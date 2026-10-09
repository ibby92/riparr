import fs from "node:fs";
import { downloadsRoot } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { notify } from "@/lib/notify";
import { getSettings, writeDiskStatus } from "@/lib/settings";

const CHECK_EVERY_MS = 30_000;
const GB = 1024 ** 3;

let lastCheck = -Infinity;
let low = false;

/**
 * True while the downloads volume is below the configured free-space floor.
 * Re-checked at most every 30s; logs and notifies once per low-space episode.
 */
export function diskIsLow(now = Date.now()): boolean {
  if (now - lastCheck < CHECK_EVERY_MS) return low;
  lastCheck = now;

  let stats;
  try {
    const root = downloadsRoot();
    fs.mkdirSync(root, { recursive: true });
    stats = fs.statfsSync(root);
  } catch (err) {
    console.error("[riparr] free-space check failed", err);
    return (low = false);
  }

  const freeBytes = stats.bavail * stats.bsize;
  const minFree = getSettings().minFreeGb * GB;
  const nowLow = minFree > 0 && freeBytes < minFree;
  writeDiskStatus({ freeBytes, totalBytes: stats.blocks * stats.bsize, low: nowLow, checkedAt: now });

  if (nowLow && !low) {
    const message = `Only ${(freeBytes / GB).toFixed(1)} GB free in the downloads folder; new downloads are paused`;
    logEvent("warn", message);
    void notify({ event: "needs_attention", message });
  } else if (!nowLow && low) {
    logEvent("info", "Free space recovered; downloads resumed");
  }
  return (low = nowLow);
}

/** Forces the next call to re-check (tests). */
export function resetDiskCheck() {
  lastCheck = -Infinity;
  low = false;
}
