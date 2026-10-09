import { one, run } from "./db";

export function getSetting(key: string): string | undefined {
  return one<{ value: string }>("SELECT value FROM settings WHERE key = ?", key)?.value;
}

export function setSetting(key: string, value: string) {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}

const HEARTBEAT_KEY = "worker.heartbeat";
export const HEARTBEAT_INTERVAL_MS = 5_000;

export function writeHeartbeat() {
  setSetting(HEARTBEAT_KEY, String(Date.now()));
}

/** Milliseconds since the worker last checked in, or null if it never has. */
export function workerHeartbeatAge(): number | null {
  const v = getSetting(HEARTBEAT_KEY);
  return v ? Date.now() - Number(v) : null;
}
