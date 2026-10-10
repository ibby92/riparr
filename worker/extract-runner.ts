import { readdir } from "node:fs/promises";
import path from "node:path";
import PQueue from "p-queue";
import { all, one, run } from "@/lib/db";
import { titlePasswords } from "@/lib/sources";
import { getTitle } from "@/lib/titles";
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
 * Called whenever a link of the title settles. Archives are only touched
 * once nothing else is pending for the title: 7-Zip can misreport a set
 * with parts still downloading as failed or password-protected.
 */
export function linkSettled(titleId: number) {
  if (pendingLinkCount(titleId) === 0) rescanTitle(titleId);
}

/** Scans these folders (absolute paths) of a title for archives to extract. */
function scheduleExtraction(titleId: number, dirs: string[]) {
  for (const dir of new Set(dirs)) {
    const key = `${titleId}:${dir}`;
    if (queued.has(key) || stop.signal.aborted) continue;
    queued.add(key);
    void queue
      .add(() => extractDir(titleId, dir))
      .catch((err) => {
        if (!stop.signal.aborted) logEvent("error", `Extraction failed in ${dir}: ${errorMessage(err)}`, titleId);
      })
      .finally(() => queued.delete(key));
  }
}

/** Rescans every folder the title has downloaded into, e.g. after a password changed. */
export function rescanTitle(titleId: number) {
  const rows = all<{ local_path: string }>(
    `SELECT DISTINCT f.local_path FROM files f JOIN links l ON l.id = f.link_id
      WHERE l.title_id = ? AND f.local_path IS NOT NULL`,
    titleId,
  );
  scheduleExtraction(
    titleId,
    rows.map((r) => path.dirname(r.local_path)),
  );
}

export function stopExtraction() {
  stop.abort();
  queue.clear();
}

/** Passwords to try: the title's sources', then any that arrived with its links. */
function passwordsFor(titleId: number) {
  const fromLinks = all<{ archive_password: string }>(
    "SELECT DISTINCT archive_password FROM links WHERE title_id = ? AND archive_password IS NOT NULL",
    titleId,
  ).map((r) => r.archive_password);
  return [...new Set([...titlePasswords(titleId), ...fromLinks].filter((p): p is string => Boolean(p)))];
}

function record(titleId: number, entryPath: string, status: Status, error: string | null, files: number) {
  run(
    `INSERT INTO extractions (title_id, entry_path, status, error, files, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (entry_path) DO UPDATE
        SET status = excluded.status, error = excluded.error, files = excluded.files, updated_at = excluded.updated_at`,
    titleId,
    entryPath,
    status,
    error,
    files,
    Date.now(),
  );
}

async function extractDir(titleId: number, dir: string) {
  const settings = getSettings();
  const title = getTitle(titleId);
  if (!settings.extractEnabled || !title) return;

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
  const passwords = passwordsFor(titleId);

  for (const set of findArchiveSets(files)) {
    const entryPath = set.entry;
    const prior = one<{ status: Status }>("SELECT status FROM extractions WHERE entry_path = ?", entryPath);
    // Settled outcomes aren't retried; `incomplete` is retried as more parts arrive.
    if (prior && prior.status !== "incomplete") continue;

    const result = await extractSet(set, { sevenZip: binary, destDir: dir, passwords, signal: stop.signal });
    switch (result.status) {
      case "extracted":
        record(titleId, entryPath, "extracted", null, result.files.length);
        if (settings.extractDeleteArchives) await deleteVolumes(set);
        logEvent("info", `Extracted ${set.name} (${result.files.length} file(s))`, titleId);
        break;
      case "incomplete":
        record(titleId, entryPath, "incomplete", null, 0);
        break;
      case "wrong_password": {
        const message = `Archive ${set.name} needs a password${passwords.length ? " (the known ones didn't work)" : ""}; set it on one of the title's sources`;
        record(titleId, entryPath, "wrong_password", message, 0);
        logEvent("warn", message, titleId);
        void notify({ event: "needs_attention", message, subject: { id: title.id, name: title.name } });
        break;
      }
      case "failed":
        record(titleId, entryPath, "failed", result.error, 0);
        logEvent("error", `Couldn't extract ${set.name}: ${result.error}`, titleId);
        break;
    }
  }
}

/** Lets a title's archives be tried again (e.g. after a password changed). */
export function resetFailedExtractions(titleId: number) {
  run("DELETE FROM extractions WHERE title_id = ? AND status IN ('wrong_password', 'failed')", titleId);
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
