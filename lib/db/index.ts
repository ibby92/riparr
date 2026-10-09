import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { migrate } from "./migrations";

export function configDir() {
  return process.env.RIPARR_CONFIG_DIR ?? path.join(process.cwd(), "config");
}

export function downloadsRoot() {
  return process.env.RIPARR_DOWNLOADS_DIR ?? path.join(process.cwd(), "downloads");
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
    migrate(db);
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
