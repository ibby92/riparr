// Client-safe formatting helpers shared by pages and components.

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 || v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** "42s", "3m 05s", "2h 14m". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** "5m ago", "in 2h", "never". */
export function formatAgo(ts: number | null | undefined, now: number): string {
  if (!ts) return "never";
  const diff = now - ts;
  const s = Math.abs(diff) / 1000;
  const [value, unit] = s < 60 ? [s, "s"] : s < 3600 ? [s / 60, "m"] : s < 86400 ? [s / 3600, "h"] : [s / 86400, "d"];
  const text = `${Math.max(1, Math.floor(value))}${unit}`;
  return diff < 0 ? `in ${text}` : `${text} ago`;
}

/** "S01E05" from numbers. */
export function episodeLabel(season: number | null | undefined, episode: number | null | undefined): string | null {
  if (episode == null) return null;
  return `S${String(season ?? 1).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}
