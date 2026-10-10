import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

const KEEP = 5;

export function backupsDir(configDir: string) {
  return path.join(configDir, "backups");
}

/**
 * Writes a consistent copy of the database to `<configDir>/backups/riparr-<label>-<timestamp>.db`
 * (VACUUM INTO works while the other process has the database open) and keeps the newest copies.
 */
export function backupDatabase(db: DatabaseSync, configDir: string, label: string, keep = KEEP): string {
  const dir = backupsDir(configDir);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `riparr-${label.replace(/[^\w.-]/g, "_")}-${stamp}.db`);
  db.prepare("VACUUM INTO ?").run(file);
  pruneBackups(dir, keep);
  return file;
}

export type BackupFile = { name: string; path: string; size: number; createdAt: number };

export function listBackups(configDir: string): BackupFile[] {
  const dir = backupsDir(configDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^riparr-.*\.db$/.test(n))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, path: full, size: stat.size, createdAt: stat.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function pruneBackups(dir: string, keep: number) {
  for (const old of listBackups(path.dirname(dir)).slice(keep)) {
    try {
      fs.unlinkSync(old.path);
    } catch {}
  }
}
