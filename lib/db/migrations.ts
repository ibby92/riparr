import type { DatabaseSync } from "node:sqlite";

// Append-only: each entry is applied once, tracked via PRAGMA user_version.
// Timestamps are Unix epoch milliseconds.
export type MigrationContext = {
  /** Absolute path that pre-v8 containers' target directories were relative to. */
  downloadsRoot: string;
};

/** SQL, or a function for migrations that need runtime values. */
export type Migration = string | ((db: DatabaseSync, ctx: MigrationContext) => void);

export const MIGRATIONS: Migration[] = [
  `
  CREATE TABLE containers (
    id                INTEGER PRIMARY KEY,
    name              TEXT    NOT NULL,
    url               TEXT    NOT NULL UNIQUE,
    password          TEXT,
    poll_interval_min INTEGER NOT NULL DEFAULT 60,
    enabled           INTEGER NOT NULL DEFAULT 1,
    target_dir        TEXT    NOT NULL,
    path_template     TEXT    NOT NULL DEFAULT '{filename}',
    status            TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'ok', 'needs_attention', 'error')),
    last_error        TEXT,
    last_checked_at   INTEGER,
    last_changed_at   INTEGER,
    next_check_at     INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL
  );

  CREATE TABLE links (
    id            INTEGER PRIMARY KEY,
    container_id  INTEGER NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
    url           TEXT    NOT NULL,
    fingerprint   TEXT    NOT NULL,
    host          TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'queued', 'resolving', 'downloading', 'done', 'failed', 'ignored', 'offline')),
    error         TEXT,
    discovered_at INTEGER NOT NULL,
    UNIQUE (container_id, fingerprint)
  );
  CREATE INDEX links_status ON links(status);

  CREATE TABLE files (
    id          INTEGER PRIMARY KEY,
    link_id     INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    remote_name TEXT    NOT NULL,
    size        INTEGER,
    hash        TEXT,
    local_path  TEXT,
    bytes_done  INTEGER NOT NULL DEFAULT 0,
    status      TEXT    NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'downloading', 'done', 'failed', 'skipped')),
    attempts    INTEGER NOT NULL DEFAULT 0,
    error       TEXT,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX files_status ON files(status);

  CREATE TABLE host_accounts (
    host        TEXT PRIMARY KEY,
    credentials TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE events (
    id           INTEGER PRIMARY KEY,
    at           INTEGER NOT NULL,
    level        TEXT    NOT NULL CHECK (level IN ('info', 'warn', 'error')),
    container_id INTEGER REFERENCES containers(id) ON DELETE CASCADE,
    message      TEXT    NOT NULL
  );
  CREATE INDEX events_at ON events(at);

  -- UI -> worker mailbox. The worker marks rows processed.
  CREATE TABLE commands (
    id           INTEGER PRIMARY KEY,
    type         TEXT    NOT NULL,
    payload      TEXT    NOT NULL DEFAULT '{}',
    created_at   INTEGER NOT NULL,
    processed_at INTEGER
  );
  `,
  // Download pipeline bookkeeping.
  `
  ALTER TABLE links ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE links ADD COLUMN retry_at INTEGER;
  ALTER TABLE links ADD COLUMN updated_at INTEGER;

  -- RemoteFile.key: stable per link across re-resolves, so restarts resume the same partial.
  ALTER TABLE files ADD COLUMN key TEXT NOT NULL DEFAULT '';
  ALTER TABLE files ADD COLUMN dir TEXT NOT NULL DEFAULT '';
  CREATE UNIQUE INDEX files_link_key ON files(link_id, key);
  `,
  // Containers fed only by Click'n'Load (e.g. captcha-protected pages) aren't polled.
  `
  ALTER TABLE containers ADD COLUMN poll INTEGER NOT NULL DEFAULT 1;
  `,
  // Archive extraction.
  `
  -- Passwords that arrived with the link (Click'n'Load "passwords" field).
  ALTER TABLE links ADD COLUMN archive_password TEXT;

  CREATE TABLE extractions (
    id           INTEGER PRIMARY KEY,
    container_id INTEGER NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
    -- Entry volume, relative to the downloads root.
    entry_path   TEXT    NOT NULL UNIQUE,
    status       TEXT    NOT NULL CHECK (status IN ('extracted', 'incomplete', 'wrong_password', 'failed')),
    error        TEXT,
    files        INTEGER NOT NULL DEFAULT 0,
    updated_at   INTEGER NOT NULL
  );
  `,
  // Live transfer speed for the queue (bytes/second, refreshed with progress).
  `
  ALTER TABLE files ADD COLUMN speed_bps INTEGER NOT NULL DEFAULT 0;
  `,
  // Mirrors: links resolve before downloading so the preferred host can be chosen.
  // Rebuilds links/files to extend their status CHECKs (SQLite can't alter them).
  `
  CREATE TABLE links_new (
    id               INTEGER PRIMARY KEY,
    container_id     INTEGER NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
    url              TEXT    NOT NULL,
    fingerprint      TEXT    NOT NULL,
    host             TEXT    NOT NULL,
    status           TEXT    NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'queued', 'resolving', 'downloading', 'done', 'failed', 'ignored', 'offline', 'mirror')),
    error            TEXT,
    discovered_at    INTEGER NOT NULL,
    attempts         INTEGER NOT NULL DEFAULT 0,
    retry_at         INTEGER,
    updated_at       INTEGER,
    archive_password TEXT,
    -- Set once the link's files are known (files rows exist).
    resolved_at      INTEGER,
    UNIQUE (container_id, fingerprint)
  );
  INSERT INTO links_new
    SELECT l.id, l.container_id, l.url, l.fingerprint, l.host, l.status, l.error, l.discovered_at, l.attempts,
           l.retry_at, l.updated_at, l.archive_password,
           CASE WHEN EXISTS (SELECT 1 FROM files f WHERE f.link_id = l.id) THEN COALESCE(l.updated_at, l.discovered_at) END
      FROM links l;
  DROP TABLE links;
  ALTER TABLE links_new RENAME TO links;
  CREATE INDEX links_status ON links(status);

  CREATE TABLE files_new (
    id          INTEGER PRIMARY KEY,
    link_id     INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    remote_name TEXT    NOT NULL,
    size        INTEGER,
    hash        TEXT,
    local_path  TEXT,
    bytes_done  INTEGER NOT NULL DEFAULT 0,
    -- standby: an identical file on a more preferred host is (or was) used instead.
    status      TEXT    NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'downloading', 'done', 'failed', 'skipped', 'standby')),
    attempts    INTEGER NOT NULL DEFAULT 0,
    error       TEXT,
    updated_at  INTEGER NOT NULL,
    key         TEXT    NOT NULL DEFAULT '',
    dir         TEXT    NOT NULL DEFAULT '',
    speed_bps   INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO files_new
    SELECT id, link_id, remote_name, size, hash, local_path, bytes_done, status, attempts, error, updated_at, key, dir, speed_bps
      FROM files;
  DROP TABLE files;
  ALTER TABLE files_new RENAME TO files;
  CREATE INDEX files_status ON files(status);
  CREATE UNIQUE INDEX files_link_key ON files(link_id, key);
  `,
  // Details some containers publish per link (release name, episode, quality, size).
  `
  ALTER TABLE links ADD COLUMN label TEXT;
  ALTER TABLE links ADD COLUMN episode TEXT;
  ALTER TABLE links ADD COLUMN quality TEXT;
  ALTER TABLE links ADD COLUMN size_text TEXT;
  `,
  // v1 schema: titles (shows/movies) in root folders, fed by one or more sources.
  // Each container becomes a title + source with the same id, keeping links, files and history.
  (db, ctx) => {
    db.exec(`
      CREATE TABLE root_folders (
        id         INTEGER PRIMARY KEY,
        path       TEXT    NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE titles (
        id             INTEGER PRIMARY KEY,
        type           TEXT    NOT NULL CHECK (type IN ('show', 'movie')),
        name           TEXT    NOT NULL,
        year           INTEGER,
        tmdb_id        INTEGER,
        overview       TEXT,
        poster_path    TEXT,
        -- Expected episode count (from TMDB, excluding specials); null if unknown.
        total_episodes INTEGER,
        root_folder_id INTEGER NOT NULL REFERENCES root_folders(id),
        -- Relative to the root folder; may contain "/".
        folder         TEXT    NOT NULL,
        season_folders INTEGER NOT NULL DEFAULT 1,
        -- File name template inside the title (and season) folder.
        naming         TEXT    NOT NULL DEFAULT '{filename}',
        -- 0 pauses the title: no polling, no new downloads.
        monitored      INTEGER NOT NULL DEFAULT 1,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX titles_tmdb ON titles(type, tmdb_id) WHERE tmdb_id IS NOT NULL;

      CREATE TABLE sources (
        id                INTEGER PRIMARY KEY,
        title_id          INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
        url               TEXT    NOT NULL UNIQUE,
        -- Container page / archive password.
        password          TEXT,
        poll_interval_min INTEGER NOT NULL DEFAULT 60,
        -- 0 stops checking this source (the title's other sources carry on).
        enabled           INTEGER NOT NULL DEFAULT 1,
        -- 0 = never fetch the page; links arrive only via Click'n'Load or by hand.
        poll              INTEGER NOT NULL DEFAULT 1,
        status            TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'ok', 'needs_attention', 'error')),
        last_error        TEXT,
        last_checked_at   INTEGER,
        last_changed_at   INTEGER,
        next_check_at     INTEGER NOT NULL DEFAULT 0,
        created_at        INTEGER NOT NULL
      );
      CREATE INDEX sources_title ON sources(title_id);
    `);

    const containers = db.prepare("SELECT * FROM containers ORDER BY id").all() as Record<string, unknown>[];
    if (containers.length) {
      const now = Date.now();
      db.prepare("INSERT INTO root_folders (id, path, created_at) VALUES (1, ?, ?)").run(ctx.downloadsRoot, now);
      const title = db.prepare(
        `INSERT INTO titles (id, type, name, root_folder_id, folder, season_folders, naming, monitored, created_at, updated_at)
         VALUES (?, 'show', ?, 1, ?, 0, ?, ?, ?, ?)`,
      );
      const source = db.prepare(
        `INSERT INTO sources (id, title_id, url, password, poll_interval_min, enabled, poll, status, last_error,
                              last_checked_at, last_changed_at, next_check_at, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const c of containers) {
        // Old layout was <downloads>/<target_dir>/<template>; keep it exactly (no season folders).
        const folder = String(c.target_dir ?? "") || String(c.name);
        const naming = String(c.path_template).replaceAll("{container}", "{title}");
        title.run(c.id as number, c.name as string, folder, naming, c.enabled as number, c.created_at as number, now);
        source.run(
          c.id as number, c.id as number, c.url as string, (c.password as string | null) ?? null,
          c.poll_interval_min as number, c.poll as number, c.status as string, (c.last_error as string | null) ?? null,
          (c.last_checked_at as number | null) ?? null, (c.last_changed_at as number | null) ?? null,
          c.next_check_at as number, c.created_at as number,
        );
      }
    }

    db.exec(`
      CREATE TABLE links_new (
        id               INTEGER PRIMARY KEY,
        title_id         INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
        -- The source that first listed this link (kept if the source is removed).
        source_id        INTEGER REFERENCES sources(id) ON DELETE SET NULL,
        url              TEXT    NOT NULL,
        fingerprint      TEXT    NOT NULL,
        host             TEXT    NOT NULL,
        status           TEXT    NOT NULL DEFAULT 'new'
                         CHECK (status IN ('new', 'queued', 'resolving', 'downloading', 'done', 'failed', 'ignored', 'offline', 'mirror')),
        error            TEXT,
        discovered_at    INTEGER NOT NULL,
        attempts         INTEGER NOT NULL DEFAULT 0,
        retry_at         INTEGER,
        updated_at       INTEGER,
        archive_password TEXT,
        resolved_at      INTEGER,
        label            TEXT,
        episode          TEXT,
        quality          TEXT,
        size_text        TEXT,
        -- Links are unique per title, so two sites listing the same host link don't duplicate it.
        UNIQUE (title_id, fingerprint)
      );
      INSERT INTO links_new
        SELECT id, container_id, container_id, url, fingerprint, host, status, error, discovered_at, attempts,
               retry_at, updated_at, archive_password, resolved_at, label, episode, quality, size_text
          FROM links;
      DROP TABLE links;
      ALTER TABLE links_new RENAME TO links;
      CREATE INDEX links_status ON links(status);
      CREATE INDEX links_source ON links(source_id);

      ALTER TABLE files ADD COLUMN season INTEGER;
      ALTER TABLE files ADD COLUMN episode INTEGER;

      CREATE TABLE extractions_new (
        id         INTEGER PRIMARY KEY,
        title_id   INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
        -- Entry volume as an absolute path.
        entry_path TEXT    NOT NULL UNIQUE,
        status     TEXT    NOT NULL CHECK (status IN ('extracted', 'incomplete', 'wrong_password', 'failed')),
        error      TEXT,
        files      INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO extractions_new (id, title_id, entry_path, status, error, files, updated_at)
        SELECT id, container_id, ?1 || '/' || entry_path, status, error, files, updated_at FROM extractions;
      DROP TABLE extractions;
      ALTER TABLE extractions_new RENAME TO extractions;

      CREATE TABLE events_new (
        id       INTEGER PRIMARY KEY,
        at       INTEGER NOT NULL,
        level    TEXT    NOT NULL CHECK (level IN ('info', 'warn', 'error')),
        title_id INTEGER REFERENCES titles(id) ON DELETE CASCADE,
        message  TEXT    NOT NULL
      );
      INSERT INTO events_new SELECT id, at, level, container_id, message FROM events;
      DROP TABLE events;
      ALTER TABLE events_new RENAME TO events;
      CREATE INDEX events_at ON events(at);

      DROP TABLE containers;
    `.replace("?1", `'${ctx.downloadsRoot.replaceAll("'", "''")}'`));
  },
  // Host limits, stalls and usage: host-wide cooldowns, per-host health, bytes per host per UTC day.
  `
    CREATE TABLE host_status (
      host              TEXT PRIMARY KEY,
      -- Host-wide cooldown (transfer cap, quota); NULL when not limited.
      limited_until     INTEGER,
      limit_reason      TEXT,
      -- Start of the current limited episode (kept while the limit is extended), for "limited too long" alerts.
      limited_since     INTEGER,
      limit_notified_at INTEGER,
      last_ok_at        INTEGER,
      last_error_at     INTEGER,
      last_error        TEXT
    );
    CREATE TABLE host_usage (
      host  TEXT    NOT NULL,
      day   TEXT    NOT NULL, -- UTC, YYYY-MM-DD
      bytes INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (host, day)
    ) WITHOUT ROWID;
    -- Consecutive stalls; after 2 another host's copy is preferred.
    ALTER TABLE files ADD COLUMN stalls INTEGER NOT NULL DEFAULT 0;
    -- Set once the user was told no working copy of this file is left.
    ALTER TABLE files ADD COLUMN blocked_notified_at INTEGER;
    CREATE INDEX links_host ON links(host);
  `,
  // Video files already in a title's folder (put there by hand or before Riparr), found by lib/disk-scan.ts.
  `
    CREATE TABLE disk_files (
      title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      path     TEXT    NOT NULL, -- absolute
      size     INTEGER NOT NULL,
      season   INTEGER,
      episode  INTEGER,
      mtime    INTEGER NOT NULL,
      PRIMARY KEY (title_id, path)
    ) WITHOUT ROWID;
    ALTER TABLE titles ADD COLUMN disk_scanned_at INTEGER;
  `,
  // Logging: a debug level, the area each entry comes from, and entries that outlive a deleted title.
  `
    CREATE TABLE events_new (
      id        INTEGER PRIMARY KEY,
      at        INTEGER NOT NULL,
      level     TEXT    NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
      title_id  INTEGER REFERENCES titles(id) ON DELETE SET NULL,
      -- Area of Riparr that wrote it: check, download, mirror, host, scan, extract, worker, web, …
      component TEXT,
      message   TEXT    NOT NULL
    );
    INSERT INTO events_new (id, at, level, title_id, message) SELECT id, at, level, title_id, message FROM events;
    DROP TABLE events;
    ALTER TABLE events_new RENAME TO events;
    CREATE INDEX events_at ON events(at);
    CREATE INDEX events_level_at ON events(level, at);
    CREATE INDEX events_title ON events(title_id);
  `,
  // History: entries that are user-facing activity carry a kind (lib/activity.ts) and structured details.
  // Earlier entries are tagged by their wording so existing history carries over.
  `
    ALTER TABLE events ADD COLUMN activity TEXT;
    ALTER TABLE events ADD COLUMN data TEXT;
    CREATE INDEX events_activity_at ON events(activity, at);

    UPDATE events SET activity = 'downloaded' WHERE message LIKE 'Downloaded %';
    UPDATE events SET activity = 'in_folder' WHERE message LIKE 'Already in the folder%';
    UPDATE events SET activity = 'links_found' WHERE message LIKE 'Found % new link%';
    UPDATE events SET activity = 'extracted' WHERE message LIKE 'Extracted %';
    UPDATE events SET activity = 'links_added'
      WHERE message LIKE 'Added % link(s) by hand' OR message LIKE 'Imported %' OR message LIKE 'API: added %'
         OR message LIKE 'Click''n''Load: received %';
    UPDATE events SET activity = 'title_added' WHERE message LIKE 'Added show "%' OR message LIKE 'Added movie "%';
    UPDATE events SET activity = 'title_edited' WHERE message LIKE 'Title edited%';
    UPDATE events SET activity = 'title_deleted' WHERE message LIKE 'Deleted show "%' OR message LIKE 'Deleted movie "%';
    UPDATE events SET activity = 'title_paused' WHERE message LIKE 'Paused;%';
    UPDATE events SET activity = 'title_resumed' WHERE message = 'Resumed';
    UPDATE events SET activity = 'source_added' WHERE message LIKE 'Source added: %';
    UPDATE events SET activity = 'source_changed' WHERE message LIKE 'Source page changed %';
    UPDATE events SET activity = 'source_removed' WHERE message LIKE 'Source removed: %';
    UPDATE events SET activity = 'source_enabled' WHERE message LIKE 'Source enabled: %';
    UPDATE events SET activity = 'source_disabled' WHERE message LIKE 'Source disabled: %';
    UPDATE events SET activity = 'link_retried' WHERE message LIKE 'Retrying % (by hand)';
    UPDATE events SET activity = 'link_ignored' WHERE message LIKE 'Ignored %';
    UPDATE events SET activity = 'root_folder_added' WHERE message LIKE 'Root folder added: %';
    UPDATE events SET activity = 'root_folder_removed' WHERE message LIKE 'Root folder removed: %';
    UPDATE events SET activity = 'settings_changed' WHERE message LIKE '% settings saved: %';
    UPDATE events SET activity = 'needs_attention'
      WHERE level = 'warn' AND (message LIKE 'This page no longer exists%' OR message LIKE 'This link has expired%'
         OR message LIKE 'Captcha%' OR message LIKE 'Container is password-protected%' OR message LIKE 'Container rejected%'
         OR message LIKE 'Blocked by an anti-bot%' OR message LIKE 'Still blocked%' OR message LIKE 'DLC: %');
    UPDATE events SET activity = 'check_failed' WHERE level = 'error' AND message LIKE 'Check failed%';
    UPDATE events SET activity = 'download_failed' WHERE message LIKE 'Failed: %';
    UPDATE events SET activity = 'no_copy' WHERE message LIKE 'No working copy of %';
    UPDATE events SET activity = 'extract_failed' WHERE message LIKE 'Couldn''t extract %' OR message LIKE 'Extraction failed in %';
    UPDATE events SET activity = 'archive_password' WHERE message LIKE 'Archive % needs a password%';
    UPDATE events SET activity = 'host_limited' WHERE message LIKE '% limited (%' OR message LIKE '% has been limited for %';
    UPDATE events SET activity = 'host_limit_ended' WHERE message LIKE '% limit has ended%' OR message LIKE '% limit cleared by hand%';
    UPDATE events SET activity = 'disk_low' WHERE message LIKE 'Only % GB free in %';
    UPDATE events SET activity = 'disk_recovered' WHERE message LIKE 'Free space recovered in %';
  `,
  // Archived titles: kept with their settings, files and history, but no longer checked or downloaded.
  `
    ALTER TABLE titles ADD COLUMN archived_at INTEGER;
  `,
];

/** Latest schema version (number of migrations). */
export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Brings the database up to date. `beforeUpgrade` runs before any migration on an
 * existing database (version > 0), e.g. to take a backup; a failure there aborts.
 */
export function migrate(
  db: DatabaseSync,
  ctx: MigrationContext = { downloadsRoot: "/downloads" },
  beforeUpgrade?: (fromVersion: number) => void,
) {
  const current = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (current > 0 && current < MIGRATIONS.length) beforeUpgrade?.(current);
  // Table rebuilds need foreign keys off, and that pragma is ignored inside a transaction.
  db.exec("PRAGMA foreign_keys = OFF");
  // IMMEDIATE takes the write lock up front so the web server and the worker
  // can't both apply the same migration when they start together.
  db.exec("BEGIN IMMEDIATE");
  try {
    const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    for (let v = user_version; v < MIGRATIONS.length; v++) {
      const step = MIGRATIONS[v];
      if (typeof step === "string") db.exec(step);
      else step(db, ctx);
    }
    const broken = db.prepare("PRAGMA foreign_key_check").all();
    if (broken.length) throw new Error(`Migration left ${broken.length} dangling foreign key(s)`);
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}
