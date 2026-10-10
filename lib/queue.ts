import { all } from "./db";
import { KNOWN_HOSTS } from "./host-ids";
import { clock, ERROR_WINDOW_MS, hostHealth, hostLabel, usageToday, type HostLimit } from "./host-status";
import { activeLinks, type FileRow, type LinkWithProgress } from "./links";

export type QueueItem = LinkWithProgress & {
  files: FileRow[];
  /** Why it isn't downloading: the host limit, the last error, or why it's on standby; null when just queued/downloading. */
  reason: string | null;
  /** When the worker will try it again (host reset or retry backoff); null when it can go as soon as a slot frees. */
  next_attempt_at: number | null;
  host_label: string;
};

export type QueueOverview = {
  /** Resolving or downloading now; furthest along first. */
  downloading: QueueItem[];
  /** Host-wide cooldowns, soonest reset first, with the links they hold. */
  waitingOnHost: { host: string; host_label: string; until: number; reason: string; items: QueueItem[] }[];
  /** Backing off after an error or stall (not a host cooldown); next attempt first. */
  retrying: QueueItem[];
  /** Ready, waiting for a download slot (or to be resolved). */
  queued: QueueItem[];
  /** Only waiting because a preferred host has the file. */
  standby: QueueItem[];
};

const UNFINISHED = new Set(["queued", "downloading", "standby", "failed"]);

function filesByLink(): Map<number, FileRow[]> {
  const rows = all<FileRow>(
    `SELECT f.* FROM files f JOIN links l ON l.id = f.link_id
      WHERE l.status IN ('new', 'queued', 'resolving', 'downloading')
      ORDER BY f.dir, f.remote_name`,
  );
  const out = new Map<number, FileRow[]>();
  for (const f of rows) {
    const list = out.get(f.link_id);
    if (list) list.push(f);
    else out.set(f.link_id, [f]);
  }
  return out;
}

const progress = (i: QueueItem) => (i.bytes_total ? i.bytes_done / i.bytes_total : 0);

/** The queue page's sections: every pending link, filed under why it is (or isn't) moving. */
export function queueOverview(now = clock.now()): QueueOverview {
  const limits = new Map<string, HostLimit>();
  for (const h of hostHealth(now)) if (h.limit) limits.set(h.host, h.limit);
  const files = filesByLink();

  const out: QueueOverview = { downloading: [], waitingOnHost: [], retrying: [], queued: [], standby: [] };
  const waiting = new Map<string, QueueOverview["waitingOnHost"][number]>();

  for (const link of activeLinks()) {
    const item: QueueItem = { ...link, files: files.get(link.id) ?? [], reason: null, next_attempt_at: null, host_label: hostLabel(link.host) };
    const limit = limits.get(link.host);

    if (link.status === "downloading" || link.status === "resolving") {
      out.downloading.push(item);
    } else if (limit) {
      item.reason = limit.reason;
      item.next_attempt_at = Math.max(limit.until, link.retry_at ?? 0);
      let group = waiting.get(link.host);
      if (!group) waiting.set(link.host, (group = { host: link.host, host_label: item.host_label, until: limit.until, reason: limit.reason, items: [] }));
      group.items.push(item);
    } else if (link.retry_at !== null && link.retry_at > now) {
      item.reason = link.error;
      item.next_attempt_at = link.retry_at;
      out.retrying.push(item);
    } else if (link.resolved_at !== null && isStandby(item)) {
      item.reason = "Another host's copy is preferred";
      out.standby.push(item);
    } else {
      out.queued.push(item);
    }
  }

  out.downloading.sort((a, b) => progress(b) - progress(a) || a.id - b.id);
  out.waitingOnHost = [...waiting.values()].sort((a, b) => a.until - b.until || a.host.localeCompare(b.host));
  out.retrying.sort((a, b) => a.next_attempt_at! - b.next_attempt_at! || a.id - b.id);
  return out;
}

/** Has unfinished files, all of them on standby (none chosen for download). */
function isStandby(item: QueueItem) {
  const open = item.files.filter((f) => UNFINISHED.has(f.status));
  return open.length > 0 && open.every((f) => f.status === "standby");
}

export type HostStatus = {
  host: string;
  host_label: string;
  state: "ok" | "limited" | "errors";
  /** Reset time while limited. */
  until: number | null;
  /** The limit's reason while limited, the last error while "errors"; else null. */
  reason: string | null;
  /** Bytes downloaded from this host on the current UTC day. */
  bytesToday: number;
  activeDownloads: number;
};

/** One entry per supported host (always, in KNOWN_HOSTS order), then any other host with activity. */
export function hostStatuses(now = clock.now()): HostStatus[] {
  const health = new Map(hostHealth(now).map((h) => [h.host, h]));
  const usage = usageToday(now);
  const active = new Map(
    all<{ host: string; n: number }>("SELECT host, COUNT(*) AS n FROM links WHERE status = 'downloading' GROUP BY host").map((r) => [r.host, r.n]),
  );
  const others = [...new Set([...health.keys(), ...usage.keys(), ...active.keys()])]
    .filter((h) => !KNOWN_HOSTS.some((k) => k.id === h))
    .sort();

  return [...KNOWN_HOSTS.map((k) => k.id as string), ...others].map((host) => {
    const h = health.get(host);
    const erroring =
      h?.lastErrorAt != null && h.lastErrorAt > now - ERROR_WINDOW_MS && h.lastErrorAt > (h.lastOkAt ?? 0);
    const state = h?.limit ? "limited" : erroring ? "errors" : "ok";
    return {
      host,
      host_label: hostLabel(host),
      state,
      until: h?.limit?.until ?? null,
      reason: h?.limit ? h.limit.reason : erroring ? h!.lastError : null,
      bytesToday: usage.get(host) ?? 0,
      activeDownloads: active.get(host) ?? 0,
    };
  });
}
