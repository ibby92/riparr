import type { FileStatus, LinkStatus } from "./links";

export type MirrorCandidate = {
  fileId: number;
  linkId: number;
  /** Resolver id, e.g. "gofile". */
  host: string;
  /** Remote file name. */
  name: string;
  /** Sub-path inside a remote folder ("" for single files). Not part of identity. */
  dir: string;
  size: number | null;
  fileStatus: FileStatus;
  linkStatus: LinkStatus;
  linkDiscoveredAt: number;
  /** Link is rate-limited/backing off until this time; null when not waiting. */
  linkRetryAt: number | null;
  /** Consecutive stalled attempts on this copy; from STALLS_TO_DEMOTE on, other hosts' copies go first. */
  fileStalls?: number;
};

/** Consecutive stalls after which a copy yields to other hosts' copies (if any). */
export const STALLS_TO_DEMOTE = 2;

export type MirrorPlan = {
  /** standby -> queued: this copy is now the one to download. */
  promote: number[];
  /** queued -> standby: another copy is preferred or already done/downloading. */
  standby: number[];
  /** Standby files whose content is already downloaded via another copy: never needed. */
  covered: number[];
};

const DEAD_LINK: ReadonlySet<LinkStatus> = new Set(["failed", "offline", "ignored"]);

/** Position of `host` in `priority` (case-insensitive); unlisted hosts tie after all listed ones. */
export function hostRank(host: string, priority: string[]): number {
  const h = host.toLowerCase();
  const i = priority.findIndex((p) => p.toLowerCase() === h);
  return i === -1 ? priority.length : i;
}

/** Identity of a file name: NFC, trimmed, case-folded. */
export function mirrorNameKey(name: string): string {
  return name.normalize("NFC").trim().toLowerCase();
}

/**
 * Groups copies of the same file. Known-size files group by (name key, size).
 * An unknown-size file joins its name's group only if that name has at most one
 * known size across the input; otherwise it stays alone. Order-independent.
 */
export function groupMirrors(files: MirrorCandidate[]): MirrorCandidate[][] {
  const sizesByName = new Map<string, Set<number>>();
  for (const f of files) {
    const key = mirrorNameKey(f.name);
    let sizes = sizesByName.get(key);
    if (!sizes) sizesByName.set(key, (sizes = new Set()));
    if (f.size !== null) sizes.add(f.size);
  }
  const groups = new Map<string, MirrorCandidate[]>();
  for (const f of files) {
    const key = mirrorNameKey(f.name);
    const sizes = sizesByName.get(key)!;
    let groupKey: string;
    if (f.size !== null) groupKey = `${f.size}\0${key}`;
    else if (sizes.size === 0) groupKey = `?\0${key}`;
    else if (sizes.size === 1) groupKey = `${[...sizes][0]}\0${key}`;
    else groupKey = `#${f.fileId}`;
    const group = groups.get(groupKey);
    if (group) group.push(f);
    else groups.set(groupKey, [f]);
  }
  return [...groups.values()];
}

/**
 * Decides which copy of each file in one container to download, given the
 * preferred host order. Copies whose link waits (`linkRetryAt > now`) only
 * win when every usable copy waits; then copies that keep stalling lose to the rest. Pure and idempotent: re-planning after applying the
 * result (same `now`) yields no promote/standby changes (`covered` is restated each time).
 */
export function planMirrors(files: MirrorCandidate[], priority: string[], now: number = Date.now()): MirrorPlan {
  const waiting = (f: MirrorCandidate) => (f.linkRetryAt !== null && f.linkRetryAt > now ? 1 : 0);
  const stalling = (f: MirrorCandidate) => ((f.fileStalls ?? 0) >= STALLS_TO_DEMOTE ? 1 : 0);
  const promote = new Set<number>();
  const standby = new Set<number>();
  const covered = new Set<number>();

  for (const group of groupMirrors(files)) {
    if (group.some((f) => f.fileStatus === "done" || f.fileStatus === "skipped")) {
      for (const f of group) {
        if (f.fileStatus === "queued") standby.add(f.fileId);
        if (f.fileStatus === "queued" || f.fileStatus === "standby") covered.add(f.fileId);
      }
      continue;
    }
    if (group.some((f) => f.fileStatus === "downloading")) {
      for (const f of group) if (f.fileStatus === "queued") standby.add(f.fileId);
      continue;
    }
    const usable = group
      .filter((f) => (f.fileStatus === "queued" || f.fileStatus === "standby") && !DEAD_LINK.has(f.linkStatus))
      .sort(
        (a, b) =>
          waiting(a) - waiting(b) ||
          stalling(a) - stalling(b) ||
          hostRank(a.host, priority) - hostRank(b.host, priority) ||
          a.linkDiscoveredAt - b.linkDiscoveredAt ||
          a.fileId - b.fileId,
      );
    const [primary, ...rest] = usable;
    if (!primary) continue;
    if (primary.fileStatus === "standby") promote.add(primary.fileId);
    for (const f of rest) if (f.fileStatus === "queued") standby.add(f.fileId);
  }

  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
  return { promote: sorted(promote), standby: sorted(standby), covered: sorted(covered) };
}

export type DiskCopy = { path: string; size: number; season: number | null; episode: number | null };

const VIDEO_NAME = /\.(mkv|mp4|m4v|avi|mov|wmv|ts|m2ts|webm|flv|mpg|mpeg)$/i;

/**
 * Pending copies (standby or queued) that a file already in the title's folder
 * makes unnecessary, with the file that covers each:
 * - shows: same season and episode (a missing season counts as season 1);
 * - movies: any video file in the folder covers the movie's pending video files.
 * `busy` holds links with a running job; their files are left alone.
 */
export function coveredByDisk(
  files: (Pick<MirrorCandidate, "fileId" | "linkId" | "name" | "fileStatus"> & { season: number | null; episode: number | null })[],
  disk: DiskCopy[],
  type: "show" | "movie",
  busy: ReadonlySet<number> = new Set(),
): { fileId: number; path: string }[] {
  if (disk.length === 0) return [];
  const pending = files.filter((f) => (f.fileStatus === "standby" || f.fileStatus === "queued") && !busy.has(f.linkId));
  if (type === "movie") {
    const videos = disk.filter((d) => VIDEO_NAME.test(d.path)).sort((a, b) => b.size - a.size);
    if (!videos.length) return [];
    return pending.filter((f) => VIDEO_NAME.test(f.name)).map((f) => ({ fileId: f.fileId, path: videos[0].path }));
  }
  const byEpisode = new Map<string, string>();
  for (const d of disk) if (d.episode != null) byEpisode.set(`${d.season ?? 1}x${d.episode}`, d.path);
  return pending.flatMap((f) => {
    const hit = f.episode == null ? undefined : byEpisode.get(`${f.season ?? 1}x${f.episode}`);
    return hit ? [{ fileId: f.fileId, path: hit }] : [];
  });
}
