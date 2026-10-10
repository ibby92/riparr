// Server-only reads for the System pages (database and filesystem).
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { all, configDir, getDb } from "@/lib/db";
import { listBackups, type BackupFile } from "@/lib/db/backup";

export function databaseInfo() {
  const file = path.join(configDir(), "riparr.db");
  const size = (p: string) => {
    try {
      return fs.statSync(p).size;
    } catch {
      return 0;
    }
  };
  const version = Number(
    (getDb().prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)?.user_version ?? 0,
  );
  return { path: file, size: size(file), walSize: size(`${file}-wal`), version };
}

export function libraryCounts() {
  const rows = all<{ type: string; n: number }>("SELECT type, COUNT(*) AS n FROM titles GROUP BY type");
  const by = Object.fromEntries(rows.map((r) => [r.type, r.n]));
  const events = all<{ n: number; first: number | null }>("SELECT COUNT(*) AS n, MIN(at) AS first FROM events")[0];
  return { shows: by.show ?? 0, movies: by.movie ?? 0, events: events?.n ?? 0, firstEventAt: events?.first ?? null };
}

export type BackupRow = BackupFile & {
  kind: "upgrade" | "manual" | "other";
  /** Schema version the backup holds, if known. */
  schema: number | null;
};

/** `riparr-v7-<stamp>.db` is the copy taken before upgrading from schema 7; others report their own user_version. */
function backupSchema(b: BackupFile): { kind: BackupRow["kind"]; schema: number | null } {
  const label = /^riparr-(.+?)-\d{4}-\d{2}-\d{2}T/.exec(b.name)?.[1] ?? "";
  const fromName = /^v(\d+)$/.exec(label);
  if (fromName) return { kind: "upgrade", schema: Number(fromName[1]) };
  let schema: number | null = null;
  try {
    const db = new DatabaseSync(b.path, { readOnly: true });
    try {
      schema = Number((db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)?.user_version ?? 0) || null;
    } finally {
      db.close();
    }
  } catch {}
  return { kind: label === "manual" ? "manual" : "other", schema };
}

export function backupRows(): BackupRow[] {
  return listBackups(configDir()).map((b) => ({ ...b, ...backupSchema(b) }));
}
