import { all, getDb, run } from "./db";

// Commands the UI sends to the worker through the `commands` table.
export type Command =
  /** Check one source now. */
  | { type: "check_now"; sourceId: number }
  /** Check every polled source of a title now. */
  | { type: "check_title"; titleId: number }
  /** Abort an in-flight download; the link's new status was already written by the UI. */
  | { type: "cancel_link"; linkId: number }
  | { type: "cancel_title"; titleId: number }
  /** Retry archives that failed or needed a password (e.g. after a source password changed). */
  | { type: "extract_title"; titleId: number }
  /** Rescan the title's folder for files already on disk (lib/disk-scan.ts). */
  | { type: "scan_title"; titleId: number };

type CommandRow = { id: number; type: string; payload: string };

export function sendCommand(command: Command) {
  const { type, ...payload } = command;
  run(
    "INSERT INTO commands (type, payload, created_at) VALUES (?, ?, ?)",
    type,
    JSON.stringify(payload),
    Date.now(),
  );
}

/** Claims every pending command, marking them processed in the same transaction. */
export function takeCommands(): Command[] {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = all<CommandRow>(
      "SELECT id, type, payload FROM commands WHERE processed_at IS NULL ORDER BY id",
    );
    if (rows.length) {
      run(
        "UPDATE commands SET processed_at = ? WHERE processed_at IS NULL AND id <= ?",
        Date.now(),
        rows[rows.length - 1].id,
      );
    }
    db.exec("COMMIT");
    return rows.map((r) => ({ type: r.type, ...JSON.parse(r.payload) }) as Command);
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function pruneCommands(olderThanMs: number) {
  run("DELETE FROM commands WHERE processed_at < ?", Date.now() - olderThanMs);
}
