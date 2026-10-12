import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrate, MIGRATIONS } from "./migrations";

/** A database at an older schema version, as an existing install would have. */
function databaseAt(version: number) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (let v = 0; v < version; v++) {
    const step = MIGRATIONS[v];
    if (typeof step === "string") db.exec(step);
    else step(db, { downloadsRoot: "/downloads" });
  }
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

    // Foreign keys are back on and still cascade from titles (formerly containers) through links to files.
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(() => db.exec("INSERT INTO files (link_id, remote_name, updated_at) VALUES (999, 'x', 1)")).toThrow();
    db.exec("DELETE FROM titles WHERE id = 1");
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

describe("migration 8 (titles, sources, root folders)", () => {
  it("turns each container into a title + source, keeping links, files, events and archives", () => {
    const db = databaseAt(7);
    db.exec(`
      INSERT INTO containers (id, name, url, password, poll_interval_min, enabled, poll, target_dir, path_template,
                              status, last_error, last_checked_at, next_check_at, created_at)
        VALUES (3, 'Doctor X', 'https://mkvdrama.net/c/x', 'pw', 30, 1, 1, 'tv/Doctor X', '{container}/{filename}',
                'ok', NULL, 500, 900, 100),
               (4, 'Paused', 'https://viewcrate.cc/c/y', NULL, 60, 0, 0, '', '{filename}', 'pending', NULL, NULL, 0, 200);
      INSERT INTO links (id, container_id, url, fingerprint, host, status, discovered_at, label, episode)
        VALUES (10, 3, 'https://pixeldrain.com/u/a', 'fp-a', 'pixeldrain', 'done', 300, 'Doctor.X.S01E01.mkv', 'S01E01');
      INSERT INTO files (id, link_id, remote_name, status, updated_at, key, local_path)
        VALUES (100, 10, 'Doctor.X.S01E01.mkv', 'done', 300, 'a', 'tv/Doctor X/Doctor X/Doctor.X.S01E01.mkv');
      INSERT INTO events (at, level, container_id, message) VALUES (400, 'info', 3, 'Downloaded');
      INSERT INTO extractions (container_id, entry_path, status, updated_at) VALUES (3, 'tv/Doctor X/a.zip', 'extracted', 1);
    `);

    migrate(db, { downloadsRoot: "/srv/media" });

    const row = (sql: string) => ({ ...db.prepare(sql).get() });
    const rows = (sql: string) => db.prepare(sql).all().map((r) => ({ ...r }));
    expect(rows("SELECT id, path FROM root_folders")).toEqual([{ id: 1, path: "/srv/media" }]);
    expect(rows("SELECT id, type, name, root_folder_id, folder, season_folders, naming, monitored FROM titles ORDER BY id")).toEqual([
      { id: 3, type: "show", name: "Doctor X", root_folder_id: 1, folder: "tv/Doctor X", season_folders: 0, naming: "{title}/{filename}", monitored: 1 },
      { id: 4, type: "show", name: "Paused", root_folder_id: 1, folder: "Paused", season_folders: 0, naming: "{filename}", monitored: 0 },
    ]);
    expect(row("SELECT title_id, url, password, poll_interval_min, poll, status, last_checked_at, next_check_at FROM sources WHERE id = 3")).toEqual({
      title_id: 3, url: "https://mkvdrama.net/c/x", password: "pw", poll_interval_min: 30, poll: 1, status: "ok", last_checked_at: 500, next_check_at: 900,
    });
    expect(row("SELECT title_id, source_id, label, episode FROM links WHERE id = 10")).toEqual({
      title_id: 3, source_id: 3, label: "Doctor.X.S01E01.mkv", episode: "S01E01",
    });
    expect(row("SELECT season, episode, local_path FROM files WHERE id = 100")).toEqual({
      season: null, episode: null, local_path: "tv/Doctor X/Doctor X/Doctor.X.S01E01.mkv",
    });
    expect(row("SELECT title_id, message FROM events")).toEqual({ title_id: 3, message: "Downloaded" });
    expect(row("SELECT title_id, entry_path FROM extractions")).toEqual({ title_id: 3, entry_path: "/srv/media/tv/Doctor X/a.zip" });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'containers'").get()).toBeUndefined();

    // Foreign keys work end to end on the new tables.
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DELETE FROM sources WHERE id = 3");
    expect(row("SELECT source_id FROM links WHERE id = 10")).toEqual({ source_id: null });
    db.exec("DELETE FROM titles WHERE id = 3");
    for (const t of ["links", "files", "extractions"]) {
      expect(row(`SELECT COUNT(*) AS n FROM ${t}`)).toEqual({ n: 0 });
    }
    // Since migration 11, log entries outlive their title.
    expect(row("SELECT COUNT(*) AS n FROM events WHERE title_id IS NULL")).toEqual({ n: 1 });
  });

  it("works on an empty database (no root folder is invented)", () => {
    const db = databaseAt(7);
    migrate(db, { downloadsRoot: "/srv/media" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM root_folders").get()).toEqual({ n: 0 });
  });

  it("runs the backup hook before upgrading an existing database, and only then", () => {
    const calls: number[] = [];
    const existing = databaseAt(7);
    migrate(existing, { downloadsRoot: "/x" }, (from) => calls.push(from));
    migrate(existing, { downloadsRoot: "/x" }, (from) => calls.push(from)); // already current
    const fresh = new DatabaseSync(":memory:");
    migrate(fresh, { downloadsRoot: "/x" }, (from) => calls.push(from)); // brand new install
    expect(calls).toEqual([7]);
  });
});

describe("migration 9 (host limits, stalls, usage)", () => {
  it("adds host tables and file stall columns, keeping existing files", () => {
    const db = databaseAt(8);
    db.exec(`
      INSERT INTO root_folders (id, path, created_at) VALUES (1, '/srv/media', 1);
      INSERT INTO titles (id, type, name, root_folder_id, folder, created_at, updated_at) VALUES (1, 'show', 'X', 1, 'X', 1, 1);
      INSERT INTO links (id, title_id, url, fingerprint, host, status, discovered_at) VALUES (10, 1, 'u', 'fp', 'mega', 'queued', 1);
      INSERT INTO files (id, link_id, remote_name, status, updated_at, key, bytes_done) VALUES (100, 10, 'a.mkv', 'standby', 1, 'a', 42);
    `);
    migrate(db);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: MIGRATIONS.length });
    expect({ ...db.prepare("SELECT bytes_done, stalls, blocked_notified_at FROM files WHERE id = 100").get() }).toEqual({
      bytes_done: 42,
      stalls: 0,
      blocked_notified_at: null,
    });
    db.exec("INSERT INTO host_status (host, limited_until, limit_reason) VALUES ('mega', 5, 'MEGA transfer quota')");
    db.exec("INSERT INTO host_usage (host, day, bytes) VALUES ('mega', '2026-10-10', 7)");
    expect(() => db.exec("INSERT INTO host_usage (host, day) VALUES ('mega', '2026-10-10')")).toThrow();
  });
});

describe("migration 10 (files already on disk)", () => {
  it("adds disk_files and titles.disk_scanned_at, cascading with the title", () => {
    const db = databaseAt(9);
    db.exec(`
      INSERT INTO root_folders (id, path, created_at) VALUES (1, '/srv/media', 1);
      INSERT INTO titles (id, type, name, root_folder_id, folder, created_at, updated_at) VALUES (1, 'show', 'X', 1, 'X', 1, 1);
    `);
    migrate(db);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: MIGRATIONS.length });
    expect({ ...db.prepare("SELECT name, disk_scanned_at FROM titles WHERE id = 1").get() }).toEqual({ name: "X", disk_scanned_at: null });
    db.exec("INSERT INTO disk_files (title_id, path, size, season, episode, mtime) VALUES (1, '/srv/media/X/X.E01.mkv', 5, 1, 1, 1)");
    db.exec("PRAGMA foreign_keys = ON; DELETE FROM titles WHERE id = 1");
    expect(db.prepare("SELECT COUNT(*) AS n FROM disk_files").get()).toEqual({ n: 0 });
  });
});

describe("migration 11 (debug logging)", () => {
  it("keeps events, allows debug, records the component, and keeps entries when their title is deleted", () => {
    const db = databaseAt(10);
    db.exec(`
      INSERT INTO root_folders (id, path, created_at) VALUES (1, '/srv/media', 1);
      INSERT INTO titles (id, type, name, root_folder_id, folder, created_at, updated_at) VALUES (1, 'show', 'X', 1, 'X', 1, 1);
      INSERT INTO events (id, at, level, title_id, message) VALUES (5, 10, 'warn', 1, 'old warning');
    `);
    expect(() => db.exec("INSERT INTO events (at, level, message) VALUES (1, 'debug', 'x')")).toThrow();
    migrate(db);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: MIGRATIONS.length });
    expect({ ...db.prepare("SELECT id, level, title_id, component, message FROM events WHERE id = 5").get() }).toEqual({
      id: 5,
      level: "warn",
      title_id: 1,
      component: null,
      message: "old warning",
    });
    db.exec("INSERT INTO events (at, level, component, message) VALUES (2, 'debug', 'check', 'reader crate-api')");
    expect(() => db.exec("INSERT INTO events (at, level, message) VALUES (3, 'trace', 'x')")).toThrow();
    db.exec("PRAGMA foreign_keys = ON; DELETE FROM titles WHERE id = 1");
    expect({ ...db.prepare("SELECT title_id, message FROM events WHERE id = 5").get() }).toEqual({ title_id: null, message: "old warning" });
  });
});

describe("migration 12 (activity for History)", () => {
  it("adds activity and data columns and tags earlier entries by their wording", () => {
    const db = databaseAt(11);
    const add = db.prepare("INSERT INTO events (at, level, message) VALUES (1, ?, ?)");
    const samples: [string, string, string | null][] = [
      ["info", "Downloaded Irreplaceable.S01E16.mkv from pixeldrain", "downloaded"],
      ["info", 'Added show "Between Steps"', "title_added"],
      ["info", "Found 10 new link(s) via crate-api", "links_found"],
      ["warn", "This link has expired on the site. Open the show's page…", "needs_attention"],
      ["warn", "pixeldrain limited (daily transfer limit); its downloads resume at …", "host_limited"],
      ["error", "Failed: https://gofile.io/d/x (gone)", "download_failed"],
      ["info", "Media Management settings saved: cnlEnabled true → false", "settings_changed"],
      ["info", "Worker started", null],
      ["warn", "Attempt 1/5 failed for https://x: boom", null],
      ["info", "Manual check requested", null],
    ];
    for (const [level, message] of samples) add.run(level, message);
    migrate(db);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: MIGRATIONS.length });
    const tagged = db.prepare("SELECT message, activity, data FROM events ORDER BY id").all() as { message: string; activity: string | null; data: string | null }[];
    expect(tagged.map((r) => r.activity)).toEqual(samples.map((s) => s[2]));
    expect(tagged.every((r) => r.data === null)).toBe(true);
  });
});

describe("migration 13 (archived titles)", () => {
  it("adds titles.archived_at, null for existing titles", () => {
    const db = databaseAt(12);
    db.exec(`
      INSERT INTO root_folders (id, path, created_at) VALUES (1, '/srv/media', 1);
      INSERT INTO titles (id, type, name, root_folder_id, folder, created_at, updated_at) VALUES (1, 'show', 'X', 1, 'X', 1, 1);
    `);
    migrate(db);
    expect({ ...db.prepare("SELECT name, monitored, archived_at FROM titles WHERE id = 1").get() }).toEqual({ name: "X", monitored: 1, archived_at: null });
  });
});
