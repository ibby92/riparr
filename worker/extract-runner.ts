import { readdir } from "node:fs/promises";
import path from "node:path";
import PQueue from "p-queue";
import { getContainer } from "@/lib/containers";
import { all, downloadsRoot, one, run } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { pendingLinkCount } from "@/lib/links";
import { notify } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { deleteVolumes, extractSet, findArchiveSets, findSevenZip, type ExtractResult } from "./extract";

// One extraction at a time: it's CPU- and disk-heavy and shares disks with downloads.
const queue = new PQueue({ concurrency: 1 });
const queued = new Set<string>();
const stop = new AbortController();
let sevenZip: Promise<string | null> | undefined;
let warnedMissing = false;

type Status = ExtractResult["status"];

/**
 * Called whenever a link of the container settles. Archives are only touched
 * once nothing else is pending for the container: 7-Zip can misreport a set
 * with parts still downloading as failed or password-protected.
 */
export function linkSettled(containerId: number) {
  if (pendingLinkCount(containerId) === 0) rescanContainer(containerId);
}

/** Scans these folders (absolute paths) of a container for archives to extract. */
function scheduleExtraction(containerId: number, dirs: string[]) {
  for (const dir of new Set(dirs)) {
    const key = `${containerId}:${dir}`;
    if (queued.has(key) || stop.signal.aborted) continue;
    queued.add(key);
    void queue
      .add(() => extractDir(containerId, dir))
      .catch((err) => {
        if (!stop.signal.aborted) logEvent("error", `Extraction failed in ${dir}: ${errorMessage(err)}`, containerId);
      })
      .finally(() => queued.delete(key));
  }
}

/** Rescans every folder the container has downloaded into, e.g. after its password changed. */
export function rescanContainer(containerId: number) {
  const root = downloadsRoot();
  const rows = all<{ local_path: string }>(
    `SELECT DISTINCT f.local_path FROM files f JOIN links l ON l.id = f.link_id
      WHERE l.container_id = ? AND f.local_path IS NOT NULL`,
    containerId,
  );
  scheduleExtraction(
    containerId,
    rows.map((r) => path.dirname(path.resolve(root, r.local_path))),
  );
}

export function stopExtraction() {
  stop.abort();
  queue.clear();
}

/** Passwords to try: the container's, then any that arrived with its links. */
function passwordsFor(containerId: number, containerPassword: string | null) {
  const fromLinks = all<{ archive_password: string }>(
    "SELECT DISTINCT archive_password FROM links WHERE container_id = ? AND archive_password IS NOT NULL",
    containerId,
  ).map((r) => r.archive_password);
  return [...new Set([containerPassword, ...fromLinks].filter((p): p is string => Boolean(p)))];
}

function record(containerId: number, entryPath: string, status: Status, error: string | null, files: number) {
  run(
    `INSERT INTO extractions (container_id, entry_path, status, error, files, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (entry_path) DO UPDATE
        SET status = excluded.status, error = excluded.error, files = excluded.files, updated_at = excluded.updated_at`,
    containerId,
    entryPath,
    status,
    error,
    files,
    Date.now(),
  );
}

async function extractDir(containerId: number, dir: string) {
  const settings = getSettings();
  const container = getContainer(containerId);
  if (!settings.extractEnabled || !container) return;

  sevenZip ??= findSevenZip();
  const binary = await sevenZip;
  if (!binary) {
    if (!warnedMissing) logEvent("warn", "7-Zip not found; archives won't be extracted (set RIPARR_7Z)");
    warnedMissing = true;
    return;
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // folder gone (deleted or moved by the user)
  }
  const files = entries.filter((e) => e.isFile()).map((e) => path.join(dir, e.name));
  const root = downloadsRoot();
  const passwords = passwordsFor(containerId, container.password);

  for (const set of findArchiveSets(files)) {
    const entryPath = path.relative(root, set.entry);
    const prior = one<{ status: Status }>("SELECT status FROM extractions WHERE entry_path = ?", entryPath);
    // Settled outcomes aren't retried; `incomplete` is retried as more parts arrive.
    if (prior && prior.status !== "incomplete") continue;

    const result = await extractSet(set, { sevenZip: binary, destDir: dir, passwords, signal: stop.signal });
    switch (result.status) {
      case "extracted":
        record(containerId, entryPath, "extracted", null, result.files.length);
        if (settings.extractDeleteArchives) await deleteVolumes(set);
        logEvent("info", `Extracted ${set.name} (${result.files.length} file(s))`, containerId);
        break;
      case "incomplete":
        record(containerId, entryPath, "incomplete", null, 0);
        break;
      case "wrong_password": {
        const message = `Archive ${set.name} needs a password${passwords.length ? " (the known ones didn't work)" : ""}; set it on the container`;
        record(containerId, entryPath, "wrong_password", message, 0);
        logEvent("warn", message, containerId);
        void notify({ event: "needs_attention", message, container });
        break;
      }
      case "failed":
        record(containerId, entryPath, "failed", result.error, 0);
        logEvent("error", `Couldn't extract ${set.name}: ${result.error}`, containerId);
        break;
    }
  }
}

/** Lets a container's archives be tried again (e.g. after its password changed). */
export function resetFailedExtractions(containerId: number) {
  run("DELETE FROM extractions WHERE container_id = ? AND status IN ('wrong_password', 'failed')", containerId);
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
