import { one, run } from "./db";
import type { NotifyEvent } from "./notify-events";

export { NOTIFY_EVENTS, type NotifyEvent } from "./notify-events";

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
  /** Host ids in order of preference for identical files on several hosts; unlisted hosts come last. */
  hostPriority: string[];
  /** A download with no new bytes for this long is aborted and resumed from its partial; 0 = off. */
  stallMinutes: number;
  /** New downloads wait while the downloads volume has less free space than this (GB); 0 = off. */
  minFreeGb: number;
  cnlEnabled: boolean;
  /** Root folder for new shows (and Click'n'Load from unknown pages); null = first root folder. */
  defaultShowRootId: number | null;
  /** Root folder for new movies; null = first root folder. */
  defaultMovieRootId: number | null;
  /** Whether new shows get Season NN folders. */
  defaultSeasonFolders: boolean;
  /** TMDB API key (v3 key or v4 read token) for search, posters and episode counts. Secret. */
  tmdbApiKey: string;
  tmdbLanguage: string;
  /** Extract finished archives (zip/rar/7z, incl. multi-part) in place. */
  extractEnabled: boolean;
  /** Delete archive volumes after a successful extraction. */
  extractDeleteArchives: boolean;
  /** Outbound proxy (http://, https://, socks5://) for container sites, or everything; "" = direct. */
  proxyUrl: string;
  proxyScope: "containers" | "all";
  /** FlareSolverr base URL for Cloudflare-protected container pages; "" = off. */
  flaresolverrUrl: string;
  notifyWebhookUrl: string;
  /** Apprise API notify endpoint, e.g. http://apprise:8000/notify/riparr. */
  notifyAppriseUrl: string;
  notifyEvents: NotifyEvent[];
};



export const DEFAULT_SETTINGS: AppSettings = {
  concurrency: 3,
  perHost: 2,
  bytesPerSecond: 0,
  stallMinutes: 3,
  minFreeGb: 5,
  hostPriority: ["gofile", "pixeldrain", "mega"],
  cnlEnabled: true,
  defaultShowRootId: null,
  defaultMovieRootId: null,
  defaultSeasonFolders: true,
  tmdbApiKey: "",
  tmdbLanguage: "en-US",
  extractEnabled: true,
  extractDeleteArchives: false,
  proxyUrl: "",
  proxyScope: "containers",
  flaresolverrUrl: "",
  notifyWebhookUrl: "",
  notifyAppriseUrl: "",
  notifyEvents: ["download_done", "download_failed", "needs_attention"],
};

const SETTING_KEYS: Record<keyof AppSettings, string> = {
  concurrency: "downloads.concurrency",
  perHost: "downloads.per_host",
  bytesPerSecond: "downloads.bytes_per_second",
  stallMinutes: "downloads.stall_minutes",
  minFreeGb: "downloads.min_free_gb",
  hostPriority: "downloads.host_priority",
  cnlEnabled: "cnl.enabled",
  defaultShowRootId: "media.default_show_root",
  defaultMovieRootId: "media.default_movie_root",
  defaultSeasonFolders: "media.season_folders",
  tmdbApiKey: "metadata.tmdb_api_key",
  tmdbLanguage: "metadata.tmdb_language",
  extractEnabled: "extract.enabled",
  extractDeleteArchives: "extract.delete_archives",
  proxyUrl: "proxy.url",
  proxyScope: "proxy.scope",
  flaresolverrUrl: "flaresolverr.url",
  notifyWebhookUrl: "notify.webhook_url",
  notifyAppriseUrl: "notify.apprise_url",
  notifyEvents: "notify.events",
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

const DISK_KEY = "worker.disk";

export type RootDiskStatus = { path: string; freeBytes: number | null; totalBytes: number | null; low: boolean };
/** Free space per root folder; `low` if any root is below the floor. */
export type DiskStatus = { roots: RootDiskStatus[]; low: boolean; checkedAt: number };

/** Written by the worker; read by the dashboard and API. */
export function writeDiskStatus(status: DiskStatus) {
  setSetting(DISK_KEY, JSON.stringify(status));
}

export function readDiskStatus(): DiskStatus | null {
  const raw = getSetting(DISK_KEY);
  return raw ? (JSON.parse(raw) as DiskStatus) : null;
}
