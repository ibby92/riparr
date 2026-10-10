import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { backupDatabase, isUpgradeBackup, listBackups } from "./backup";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-backup-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("backupDatabase", () => {
  it("writes a readable copy and keeps 5 of each kind", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (x); INSERT INTO t VALUES (42);");
    for (let i = 0; i < 6; i++) {
      backupDatabase(db, dir, `v${i}`);
      // Distinct mtimes so ordering is stable.
      await new Promise((r) => setTimeout(r, 5));
    }
    for (let i = 0; i < 7; i++) {
      backupDatabase(db, dir, "manual");
      await new Promise((r) => setTimeout(r, 5));
    }
    const backups = listBackups(dir);
    expect(backups.filter((b) => isUpgradeBackup(b.name))).toHaveLength(5);
    expect(backups.filter((b) => !isUpgradeBackup(b.name))).toHaveLength(5);
    // The oldest pre-upgrade backup (v0) was the one dropped.
    expect(backups.some((b) => b.name.startsWith("riparr-v0-"))).toBe(false);
    const copy = new DatabaseSync(backups[0].path);
    expect(copy.prepare("SELECT x FROM t").get()).toEqual({ x: 42 });
  });
});
