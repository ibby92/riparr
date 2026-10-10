import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { backupDatabase } from "./backup";
import { migrate } from "./migrations";

// Defaults are relative to the working directory (dev). Written without
// process.cwd() so Next's file tracer doesn't copy the whole project into the
// standalone build.
export function configDir() {
  return path.resolve(process.env.RIPARR_CONFIG_DIR || "config");
}

export function downloadsRoot() {
  return path.resolve(process.env.RIPARR_DOWNLOADS_DIR || "downloads");
}

// Cached on globalThis so dev-mode module reloads reuse one connection.
const g = globalThis as { __riparrDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (!g.__riparrDb) {
    fs.mkdirSync(configDir(), { recursive: true });
    const db = new DatabaseSync(path.join(configDir(), "riparr.db"));
    // busy_timeout first: the WAL switch itself needs a lock the other process may hold.
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    // Every upgrade of an existing database is preceded by a backup in /config/backups.
    migrate(db, { downloadsRoot: downloadsRoot() }, (from) => backupDatabase(db, configDir(), `v${from}`));
    g.__riparrDb = db;
  }
  return g.__riparrDb;
}

export function closeDb() {
  g.__riparrDb?.close();
  g.__riparrDb = undefined;
}

// node:sqlite returns null-prototype objects; copy them into plain objects.
export function all<T>(sql: string, ...params: (string | number | null)[]): T[] {
  return getDb()
    .prepare(sql)
    .all(...params)
    .map((row) => ({ ...row }) as T);
}

export function one<T>(sql: string, ...params: (string | number | null)[]): T | undefined {
  const row = getDb().prepare(sql).get(...params);
  return row ? ({ ...row } as T) : undefined;
}

export function run(sql: string, ...params: (string | number | null)[]) {
  return getDb().prepare(sql).run(...params);
}
