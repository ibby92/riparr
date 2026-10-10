"use server";

import fs from "node:fs";
import path from "node:path";
import { refresh } from "next/cache";
import { z } from "zod";
import { configDir, getDb } from "@/lib/db";
import { backupDatabase, backupsDir, listBackups } from "@/lib/db/backup";
import { requireSession } from "@/lib/session";

export type BackupState = { error?: string; message?: string; at?: number };

export async function backupNow(): Promise<BackupState> {
  await requireSession();
  try {
    const file = backupDatabase(getDb(), configDir(), "manual");
    refresh();
    return { message: `Saved ${path.basename(file)}`, at: Date.now() };
  } catch (err) {
    return { error: `Backup failed: ${err instanceof Error ? err.message : String(err)}`, at: Date.now() };
  }
}

const backupName = z.string().regex(/^riparr-[\w.-]+\.db$/, "Not a backup file");

export async function deleteBackup(formData: FormData) {
  await requireSession();
  const name = backupName.parse(formData.get("name"));
  // Only files listBackups knows, inside the backups folder.
  if (!listBackups(configDir()).some((b) => b.name === name)) return;
  fs.rmSync(path.join(backupsDir(configDir()), name), { force: true });
  refresh();
}
