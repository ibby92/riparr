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

export type AppSettings = {
  /** Links downloading at once, across all hosts. */
  concurrency: number;
  /** Links downloading at once from a single host. */
  perHost: number;
  /** Per-download speed cap in bytes/second; 0 = unlimited. */
  bytesPerSecond: number;
  cnlEnabled: boolean;
  /** Where Click'n'Load links from unknown pages go, relative to the downloads folder. */
  cnlTargetDir: string;
  cnlTemplate: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  concurrency: 3,
  perHost: 2,
  bytesPerSecond: 0,
  cnlEnabled: true,
  cnlTargetDir: "clicknload",
  cnlTemplate: "{container}/{dir}/{filename}",
};

const SETTING_KEYS: Record<keyof AppSettings, string> = {
  concurrency: "downloads.concurrency",
  perHost: "downloads.per_host",
  bytesPerSecond: "downloads.bytes_per_second",
  cnlEnabled: "cnl.enabled",
  cnlTargetDir: "cnl.target_dir",
  cnlTemplate: "cnl.template",
};

export function getSettings(): AppSettings {
  const out = { ...DEFAULT_SETTINGS } as Record<keyof AppSettings, unknown>;
  for (const key of Object.keys(SETTING_KEYS) as (keyof AppSettings)[]) {
    const raw = getSetting(SETTING_KEYS[key]);
    if (raw !== undefined) out[key] = JSON.parse(raw);
  }
  return out as AppSettings;
}

export function saveSettings(settings: Partial<AppSettings>) {
  for (const [key, value] of Object.entries(settings) as [keyof AppSettings, unknown][]) {
    if (value !== undefined) setSetting(SETTING_KEYS[key], JSON.stringify(value));
  }
}
