import type { DatabaseSync } from "node:sqlite";

// Append-only: each entry is applied once, tracked via PRAGMA user_version.
// Timestamps are Unix epoch milliseconds.
const MIGRATIONS: string[] = [
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
];

export function migrate(db: DatabaseSync) {
  // IMMEDIATE takes the write lock up front so the web server and the worker
  // can't both apply the same migration when they start together.
  db.exec("BEGIN IMMEDIATE");
  try {
    const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    for (let v = user_version; v < MIGRATIONS.length; v++) {
      db.exec(MIGRATIONS[v]);
    }
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
