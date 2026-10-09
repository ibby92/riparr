import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrate, MIGRATIONS } from "./migrations";

/** A database at an older schema version, as an existing install would have. */
function databaseAt(version: number) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (let v = 0; v < version; v++) db.exec(MIGRATIONS[v]);
  db.exec(`PRAGMA user_version = ${version}`);
  return db;
}

describe("migration 6 (links/files rebuild)", () => {
  it("keeps data, marks resolved links, and keeps foreign keys and cascades working", () => {
    const db = databaseAt(5);
    db.exec(`
      INSERT INTO containers (id, name, url, target_dir, created_at) VALUES (1, 'Show', 'https://c.example/1', 'tv', 1);
      INSERT INTO links (id, container_id, url, fingerprint, host, status, discovered_at, updated_at, archive_password)
        VALUES (10, 1, 'https://pixeldrain.com/u/a', 'fp-a', 'pixeldrain', 'done', 100, 200, 'pw'),
               (11, 1, 'https://gofile.io/d/b', 'fp-b', 'gofile', 'new', 150, NULL, NULL);
      INSERT INTO files (id, link_id, remote_name, size, status, updated_at, key, dir, speed_bps, bytes_done)
        VALUES (100, 10, 'a.mkv', 5, 'done', 200, 'a', '', 0, 5);
      INSERT INTO extractions (container_id, entry_path, status, updated_at) VALUES (1, 'tv/a.zip', 'extracted', 1);
    `);

    migrate(db);

    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: MIGRATIONS.length });
    expect(db.prepare("SELECT id, status, archive_password, resolved_at FROM links ORDER BY id").all().map((r) => ({ ...r }))).toEqual([
      { id: 10, status: "done", archive_password: "pw", resolved_at: 200 },
      { id: 11, status: "new", archive_password: null, resolved_at: null },
    ]);
    expect({ ...db.prepare("SELECT remote_name, bytes_done, key FROM files WHERE id = 100").get() }).toEqual({
      remote_name: "a.mkv",
      bytes_done: 5,
      key: "a",
    });

    // New statuses are accepted; junk still isn't.
    db.exec("UPDATE links SET status = 'mirror' WHERE id = 11");
    db.exec("UPDATE files SET status = 'standby' WHERE id = 100");
    expect(() => db.exec("UPDATE links SET status = 'bogus' WHERE id = 11")).toThrow();

    // Foreign keys are back on and still cascade from containers through links to files.
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(() => db.exec("INSERT INTO files (link_id, remote_name, updated_at) VALUES (999, 'x', 1)")).toThrow();
    db.exec("DELETE FROM containers WHERE id = 1");
    expect(db.prepare("SELECT COUNT(*) AS n FROM links").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM files").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM extractions").get()).toEqual({ n: 0 });
  });

  it("is idempotent and keeps indexes", () => {
    const db = databaseAt(5);
    migrate(db);
    migrate(db);
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    expect(indexes.map((r) => r.name)).toEqual(
      expect.arrayContaining(["files_link_key", "files_status", "links_status"]),
    );
  });
});
