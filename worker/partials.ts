// Partial downloads: <root>/.riparr-partial/<name>.part, resumed with Range requests.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { all } from "@/lib/db";
import { logDebug, logEvent } from "@/lib/events";

export const PARTIAL_DIR = ".riparr-partial";
const HOUR = 60 * 60 * 1000;

/**
 * Partial file name for a file row. SQLite reuses the ids of deleted rows, so
 * the name also carries a hash of the link and file key: a new file that gets
 * an old id never resumes onto someone else's leftover bytes.
 */
export function partialName(fileId: number, linkUrl: string, key: string): string {
  const tag = crypto.createHash("sha1").update(`${linkUrl}\n${key}`).digest("hex").slice(0, 12);
  return `${fileId}-${tag}.part`;
}

/** Partials written before names carried a hash: "<fileId>.part". */
function legacyName(fileId: number) {
  return `${fileId}.part`;
}

function sizeOf(p: string): number | null {
  try {
    return fs.statSync(p).size;
  } catch {
    return null;
  }
}

/**
 * Where a file's partial lives. A legacy "<id>.part" is adopted only when its
 * size matches the progress recorded for this very file row, so an
 * interrupted download from before the upgrade still resumes.
 */
export function partialPathFor(dir: string, fileId: number, linkUrl: string, key: string, bytesDone: number): string {
  const current = path.join(dir, partialName(fileId, linkUrl, key));
  if (bytesDone > 0 && sizeOf(current) === null) {
    const legacy = path.join(dir, legacyName(fileId));
    if (sizeOf(legacy) === bytesDone) {
      try {
        fs.renameSync(legacy, current);
        logDebug("disk", `Adopted pre-upgrade partial ${path.basename(legacy)} as ${path.basename(current)}`);
      } catch {
        // Leave it; the download starts over.
      }
    }
  }
  return current;
}

type PendingFile = { id: number; key: string; url: string; bytes_done: number };

/**
 * Deletes partials no unfinished file will resume: leftovers of deleted
 * titles, links or files, and files that finished or were skipped another
 * way. Files younger than `minAgeMs` are kept, in case a download just started.
 * Returns what was removed.
 */
export function sweepPartials(roots: string[], now = Date.now(), minAgeMs = HOUR): { files: number; bytes: number } {
  const pending = all<PendingFile>(
    `SELECT f.id, f.key, l.url, f.bytes_done FROM files f JOIN links l ON l.id = f.link_id
      WHERE f.status NOT IN ('done', 'skipped')`,
  );
  const wanted = new Set<string>();
  const legacy = new Map<string, number>();
  for (const f of pending) {
    wanted.add(partialName(f.id, f.url, f.key));
    if (f.bytes_done > 0) legacy.set(legacyName(f.id), f.bytes_done);
  }

  let files = 0;
  let bytes = 0;
  for (const root of roots) {
    const dir = path.join(root, PARTIAL_DIR);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".part") || wanted.has(name)) continue;
      const full = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile() || now - st.mtimeMs < minAgeMs) continue;
      if (legacy.get(name) === st.size) continue; // adopted when its download resumes
      try {
        fs.unlinkSync(full);
        logDebug("disk", `Removed leftover partial ${full} (${(st.size / 1024 ** 2).toFixed(1)} MB)`);
        files++;
        bytes += st.size;
      } catch {
        // Not ours to delete (permissions); try again next sweep.
      }
    }
  }
  if (files) logEvent("info", `Removed ${files} leftover partial download(s), ${(bytes / 1024 ** 3).toFixed(1)} GB`, null, "disk");
  return { files, bytes };
}
