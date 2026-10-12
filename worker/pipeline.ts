import path from "node:path";
import PQueue from "p-queue";
import { downloadFile } from "@/lib/download";
import { HostOfflineError, NeedsAttentionError, RateLimitError, StallError } from "@/lib/errors";
import type { ActivityData } from "@/lib/activity";
import { logDebug, logEvent } from "@/lib/events";
import { dateTime } from "@/lib/time";
import { hostAccount } from "@/lib/host-accounts";
import {
  addHostUsage,
  clock,
  HOST_COOLDOWN_MIN_MS,
  hostLabel,
  hostLimit,
  holdLimitedHosts,
  LONG_LIMIT_MS,
  limitReason,
  notifyLongLimits,
  recordHostError,
  recordHostLimit,
  recordHostOk,
} from "@/lib/host-status";
import { findResolver } from "@/lib/hosts";
import type { RemoteFile } from "@/lib/hosts/types";
import {
  titleFiles,
  titlesWithActiveLinks,
  unresolvedLinkCount,
  downloadableLinks,
  failLinkFiles,
  getLink,
  listFiles,
  markResolved,
  parkLinkFiles,
  resolvingInProgress,
  setFileStatuses,
  setLinkStatus,
  unresolvedLinks,
  updateFile,
  upsertFiles,
  type FileRow,
  type Link,
  type TitleFile,
} from "@/lib/links";
import { coveredByDisk, groupMirrors, mirrorNameKey, planMirrors } from "@/lib/mirrors";
import { externalDiskFiles, scanTitle } from "@/lib/disk-scan";
import { fetchFor } from "@/lib/net";
import { notify } from "@/lib/notify";
import { parseEpisode } from "@/lib/episodes";
import { resolveInside } from "@/lib/paths";
import { getSource, titlePasswords } from "@/lib/sources";
import { fileDestination, getTitle, type TitleWithStats } from "@/lib/titles";
import { getSettings } from "@/lib/settings";
import { diskIsLow } from "./disk";
import { PARTIAL_DIR, partialPathFor } from "./partials";
import { linkSettled } from "./extract-runner";

const MINUTE = 60_000;
const MAX_ATTEMPTS = 5;
const PROGRESS_WRITE_MS = 1_000;
const RESOLVE_CONCURRENCY = 4;
/** A stalled download retries soon: the partial is kept and the host is usually fine. */
const STALL_RETRY_MS = 30_000;

type Job = { link: Link; controller: AbortController };

const jobs = new Map<number, Job>();
const hostQueues = new Map<string, PQueue>();
let globalQueue: PQueue | undefined;
// Resolving is a quick API call; it shouldn't wait behind hour-long downloads.
const resolveQueue = new PQueue({ concurrency: RESOLVE_CONCURRENCY });

function queues(host: string) {
  const settings = getSettings();
  globalQueue ??= new PQueue({ concurrency: settings.concurrency });
  let hostQueue = hostQueues.get(host);
  if (!hostQueue) {
    hostQueue = new PQueue({ concurrency: settings.perHost });
    hostQueues.set(host, hostQueue);
  }
  return { globalQueue, hostQueue };
}

/** Applies concurrency changes from the settings page to running queues. */
function applyConcurrency() {
  const { concurrency, perHost } = getSettings();
  if (globalQueue && globalQueue.concurrency !== concurrency) globalQueue.concurrency = concurrency;
  for (const q of hostQueues.values()) if (q.concurrency !== perHost) q.concurrency = perHost;
}

/** Retry delay after the nth consecutive failure: 1m, 2m, 4m, … capped at 6h. */
export function retryDelay(attempts: number) {
  return Math.min(MINUTE * 2 ** Math.max(0, attempts - 1), 6 * 60 * MINUTE);
}

/** Tracks a link's job (so it can be cancelled) for as long as `run` takes. */
function startJob(link: Link, shutdown: AbortSignal, run: (signal: AbortSignal) => Promise<unknown>) {
  const controller = new AbortController();
  jobs.set(link.id, { link, controller });
  void run(AbortSignal.any([shutdown, controller.signal])).finally(() => jobs.delete(link.id));
}

/**
 * One scheduling pass: resolve new links, choose which host's copy of each
 * file to download, settle finished links, then start downloads.
 */
export function scheduleDownloads(shutdown: AbortSignal) {
  const now = clock.now();
  applyConcurrency();
  // Host cooldowns hold every pending link of the host (retry_at), so the queries below skip them.
  holdLimitedHosts(now);
  notifyLongLimits(now);

  for (const link of unresolvedLinks(now)) {
    if (jobs.has(link.id) || shutdown.aborted) continue;
    startJob(link, shutdown, (signal) => resolveQueue.add(() => resolveLink(link, signal)));
  }

  for (const titleId of titlesWithActiveLinks()) selectAndSettle(titleId, now);

  for (const link of downloadableLinks(now)) {
    if (jobs.has(link.id) || shutdown.aborted) continue;
    // Running downloads finish; nothing new starts on a root folder that's low on space.
    const root = getTitle(link.title_id)?.root_path;
    if (!root || diskIsLow(root)) continue;
    const { globalQueue, hostQueue } = queues(link.host);
    // Host slot first, then a global slot, so one busy host can't starve the rest.
    startJob(link, shutdown, (signal) => hostQueue.add(() => globalQueue.add(() => downloadLink(link, signal))));
  }
}

export function cancelLink(linkId: number) {
  jobs.get(linkId)?.controller.abort();
}

export function cancelTitle(titleId: number) {
  for (const job of jobs.values()) {
    if (job.link.title_id === titleId) job.controller.abort();
  }
}

export function activeJobCount() {
  return jobs.size;
}

/** Mirror selection for one title (across all its sources), then finalizes links whose files are all accounted for. */
export function selectAndSettle(titleId: number, now = clock.now()) {
  // Wait until every freshly found link is resolved, so a quick host doesn't win by default.
  if (resolvingInProgress(titleId)) return;
  const priority = getSettings().hostPriority;
  let files = titleFiles(titleId);
  // Episodes already in the folder (from before Riparr, or added by hand) aren't downloaded again.
  const title = getTitle(titleId);
  if (title && files.some((f) => f.fileStatus === "standby" || f.fileStatus === "queued")) {
    if (title.disk_scanned_at === null) scanTitle(titleId);
    const onDisk = coveredByDisk(files, externalDiskFiles(titleId), title.type, new Set(jobs.keys()));
    for (const c of onDisk) {
      updateFile(c.fileId, { status: "skipped", local_path: c.path });
      logDebug("mirror", () => `Skipping ${files.find((f) => f.fileId === c.fileId)?.name}: already in the folder as ${path.basename(c.path)}`, titleId);
    }
    if (onDisk.length) files = titleFiles(titleId);
  }
  const plan = planMirrors(files, priority, now);
  setFileStatuses(plan.promote, "queued");
  setFileStatuses(plan.standby, "standby");
  if (plan.promote.length || plan.standby.length) {
    logDebug("mirror", () => {
      const describe = (ids: number[]) =>
        ids.map((id) => files.find((f) => f.fileId === id)).map((f) => (f ? `${f.name} on ${f.host}` : "?")).join(", ");
      // Each chosen copy with the hosts it was preferred over.
      const chosen = plan.promote.map((id) => {
        const f = files.find((x) => x.fileId === id);
        if (!f) return "?";
        const others = files.filter((x) => x.fileId !== id && mirrorNameKey(x.name) === mirrorNameKey(f.name) && x.size === f.size).map((x) => x.host);
        return `${f.name} on ${f.host}${others.length ? ` (over ${[...new Set(others)].join(", ")})` : ""}`;
      });
      return [
        chosen.length ? `Chosen: ${chosen.join(", ")}` : null,
        plan.standby.length ? `On standby: ${describe(plan.standby)}` : null,
        `(host order ${priority.join(" > ")})`,
      ]
        .filter(Boolean)
        .join("; ");
    }, titleId);
  }
  settleLinks(titleId, new Set(plan.covered));
  notifyBlockedFiles(titleId, files, now);
}

/**
 * Tells the user (once per file) when a title can't progress: every copy of a
 * file is on a dead link or on a host that has been limited for LONG_LIMIT_MS.
 */
function notifyBlockedFiles(titleId: number, files: TitleFile[], now: number) {
  if (files.length === 0 || unresolvedLinkCount(titleId) > 0) return;
  const longLimited = (host: string) => {
    const limit = hostLimit(host, now);
    return limit !== null && limit.since <= now - LONG_LIMIT_MS;
  };
  const dead = new Set(["failed", "offline", "ignored"]);
  for (const group of groupMirrors(files)) {
    const copies = group as TitleFile[];
    if (copies.some((f) => ["done", "skipped", "downloading"].includes(f.fileStatus))) continue;
    if (copies.some((f) => f.blockedNotifiedAt !== null)) continue;
    const blocked = copies.every(
      (f) => f.fileStatus === "failed" || dead.has(f.linkStatus) || longLimited(f.host),
    );
    if (!blocked) continue;
    for (const f of copies) updateFile(f.fileId, { blocked_notified_at: now });
    const title = getTitle(titleId);
    const hosts = [...new Set(copies.map((f) => hostLabel(f.host)))].join(", ");
    const message = `No working copy of ${copies[0].name} (tried ${hosts})`;
    logEvent("error", message, titleId, "mirror", { kind: "no_copy", data: { files: [{ name: copies[0].name, season: copies[0].season, episode: copies[0].episode, size: copies[0].size }] } });
    void notify({ event: "needs_attention", message, subject: title && { id: title.id, name: title.name } });
  }
}

function settleLinks(titleId: number, covered: Set<number>) {
  const byLink = new Map<number, { status: string; files: { id: number; status: string; name: string }[] }>();
  for (const f of titleFiles(titleId)) {
    if (f.linkStatus !== "queued" || f.linkResolvedAt === null || jobs.has(f.linkId)) continue;
    const entry = byLink.get(f.linkId) ?? { status: f.linkStatus, files: [] };
    entry.files.push({ id: f.fileId, status: f.fileStatus, name: f.name });
    byLink.set(f.linkId, entry);
  }

  const title = getTitle(titleId);
  const subject = title && { id: title.id, name: title.name };
  for (const [linkId, { files }] of byLink) {
    const finished = files.every(
      (f) => f.status === "done" || f.status === "skipped" || (f.status === "standby" && covered.has(f.id)),
    );
    if (!finished) continue;

    const downloaded = files.filter((f) => f.status === "done" || f.status === "skipped");
    const link = getLink(linkId)!;
    const rows = new Map(listFiles(linkId).map((r) => [r.id, r]));
    const details = (list: typeof downloaded): ActivityData => ({
      host: link.host,
      bytes: list.reduce((n, f) => n + (rows.get(f.id)?.size ?? 0), 0),
      files: list.map((f) => {
        const r = rows.get(f.id);
        return { name: f.name, season: r?.season ?? null, episode: r?.episode ?? null, size: r?.size ?? null };
      }),
    });
    if (downloaded.length && downloaded.every((f) => f.status === "skipped")) {
      // Nothing transferred: the files were already in the title's folder.
      setLinkStatus(linkId, "done", { attempts: 0 });
      const names = downloaded.length === 1 ? downloaded[0].name : `${downloaded.length} files`;
      logEvent("info", `Already in the folder, not downloaded: ${names}`, titleId, "download", { kind: "in_folder", data: details(downloaded) });
    } else if (downloaded.length) {
      setLinkStatus(linkId, "done", { attempts: 0 });
      const names = downloaded.length === 1 ? downloaded[0].name : `${downloaded.length} files`;
      const viaMirrors = downloaded.length < files.length ? ` (${files.length - downloaded.length} from other hosts)` : "";
      const fetched = downloaded.filter((f) => f.status === "done");
      logEvent("info", `Downloaded ${names} from ${link.host}${viaMirrors}`, titleId, "download", { kind: "downloaded", data: details(fetched.length ? fetched : downloaded) });
      void notify({ event: "download_done", message: `Downloaded ${names}`, subject });
    } else {
      setLinkStatus(linkId, "mirror", { attempts: 0 });
      logDebug("mirror", `Not needed: ${link.url} (its files came from preferred hosts)`, titleId);
    }
    linkSettled(titleId);
  }
}

/** Checks the link is still wanted, returning it with its title. */
function stillWanted(link: Link) {
  // The UI may have changed it (ignored, deleted) while it waited in the queue.
  const current = getLink(link.id);
  const title = current && getTitle(current.title_id);
  if (!current || !title || !title.monitored || !["new", "queued"].includes(current.status)) return null;
  // The host may have hit a limit while this waited for a slot; the cooldown holds it.
  if (hostLimit(current.host)) return null;
  return { current, title };
}

async function resolveFiles(link: Link, title: TitleWithStats, signal: AbortSignal) {
  const resolver = findResolver(link.url);
  if (!resolver) throw new UnsupportedHostError(`No resolver for ${link.host}`);
  const remote = await resolver.resolve(new URL(link.url), {
    account: hostAccount(resolver.id),
    // Folder passwords: the source that listed the link first, then any of the title's.
    password: (link.source_id ? getSource(link.source_id)?.password : null) ?? titlePasswords(title.id)[0] ?? null,
    signal,
    fetch: fetchFor("host"),
  });
  if (remote.length === 0) throw new HostOfflineError("Link resolved to no files");
  const rows = upsertFiles(
    link.id,
    remote.map((f) => ({
      key: f.key,
      name: f.name,
      dir: f.dir,
      size: f.size,
      hash: f.hash ? `${f.hash.algo}:${f.hash.value}` : null,
    })),
    parseEpisode(link.episode ?? link.label),
  );
  return { remote, rows };
}

/** Learns which files a link holds, without downloading. */
async function resolveLink(link: Link, signal: AbortSignal) {
  if (signal.aborted) return;
  const wanted = stillWanted(link);
  if (!wanted) return;
  try {
    setLinkStatus(link.id, "resolving", { attempts: wanted.current.attempts });
    const started = Date.now();
    const { remote } = await resolveFiles(link, wanted.title, signal);
    logDebug(
      "download",
      () => `Resolved ${link.url} in ${Date.now() - started} ms: ${remote.length} file(s), ${formatSize(remote.reduce((n, f) => n + (f.size ?? 0), 0))}${remote.length <= 5 ? ` (${remote.map((f) => f.name).join(", ")})` : ""}`,
      link.title_id,
    );
    markResolved(link.id);
    recordHostOk(link.host);
  } catch (err) {
    handleFailure(link, wanted.current.attempts, err, signal);
  }
}

/** Downloads the link's files that mirror selection chose; settling happens on the next pass. */
async function downloadLink(link: Link, signal: AbortSignal) {
  if (signal.aborted) return;
  const wanted = stillWanted(link);
  if (!wanted) return;
  const { current, title } = wanted;
  try {
    setLinkStatus(link.id, "downloading", { attempts: current.attempts });
    // Re-resolve for fresh download handles (tokens, signed URLs).
    const { remote } = await resolveFiles(link, title, signal);
    recordHostOk(link.host);
    const byKey = new Map(remote.map((f) => [f.key, f]));

    for (const row of listFiles(link.id)) {
      // Selection may have moved files to standby while this ran; re-read each time.
      const fresh = listFiles(link.id).find((r) => r.id === row.id);
      if (fresh?.status !== "queued") continue;
      const file = byKey.get(row.key);
      if (!file) {
        updateFile(row.id, { status: "failed", error: "No longer on the host" });
        continue;
      }
      await downloadOne(title, link, fresh, file, signal);
    }
    setLinkStatus(link.id, "queued", { attempts: 0 });
  } catch (err) {
    handleFailure(link, current.attempts, err, signal);
  }
}

async function downloadOne(title: TitleWithStats, link: Link, row: FileRow, file: RemoteFile, signal: AbortSignal) {
  const fileId = row.id;
  const finalPath = fileDestination(title, title.root_path, {
    season: row.season,
    episode: row.episode,
    host: link.host,
    filename: file.name,
    dir: file.dir,
    date: new Date(link.discovered_at),
  });
  // Partials live on the same root folder, so the final move is an atomic rename.
  const partialPath = partialPathFor(resolveInside(title.root_path, PARTIAL_DIR), fileId, link.url, row.key, row.bytes_done);

  updateFile(fileId, { status: "downloading", error: null });
  const settings = getSettings();
  const started = Date.now();
  let startOffset = 0;
  logDebug("download", () => `Starting ${file.name} (${file.size != null ? formatSize(file.size) : "size unknown"}) from ${link.host} → ${finalPath}`, link.title_id);
  let lastWrite = 0;
  let lastBytes: number | null = null;
  // Data used per host: bytes fetched this run, counted from where the transfer started.
  let counted: number | null = null;
  let latest = 0;
  const countUsage = () => {
    if (counted === null || latest <= counted) return;
    addHostUsage(link.host, latest - counted);
    counted = latest;
  };
  try {
    const result = await downloadFile(file, {
      finalPath,
      partialPath,
      signal,
      bytesPerSecond: settings.bytesPerSecond || null,
      stallMs: settings.stallMinutes > 0 ? settings.stallMinutes * MINUTE : null,
      onStart: (offset) => {
        counted = latest = startOffset = offset;
        if (offset > 0) logDebug("download", `Resuming ${file.name} at ${formatSize(offset)}`, link.title_id);
        else if (row.bytes_done > 0) logDebug("download", `${link.host} ignored the resume request for ${file.name}; starting over`, link.title_id);
      },
      onProgress: (bytes) => {
        latest = bytes;
        const now = Date.now();
        if (now - lastWrite < PROGRESS_WRITE_MS) return;
        // The first sample includes resumed bytes, so speed starts from the second.
        const speed = lastBytes === null ? 0 : Math.round(((bytes - lastBytes) * 1000) / (now - lastWrite));
        lastWrite = now;
        lastBytes = bytes;
        updateFile(fileId, { bytes_done: bytes, speed_bps: Math.max(0, speed) });
        countUsage();
      },
    });
    updateFile(fileId, {
      status: result.status,
      local_path: result.path,
      speed_bps: 0,
      bytes_done: file.size ?? ("bytes" in result ? result.bytes : 0),
      stalls: 0,
    });
    recordHostOk(link.host);
    logDebug("download", () => {
      if (result.status === "skipped") return `Skipped ${file.name}: an identical file is already at ${result.path}`;
      const secs = Math.max(1, (Date.now() - started) / 1000);
      const fetched = Math.max(0, latest - startOffset);
      return `Finished ${file.name} in ${Math.round(secs)} s (${formatSize(result.bytes)}, ${formatSize(fetched / secs)}/s) → ${result.path}`;
    }, link.title_id);
  } catch (err) {
    updateFile(fileId, {
      status: signal.aborted ? "queued" : "failed",
      error: errorMessage(err),
      speed_bps: 0,
      // Partial files are kept, so progress so far stays visible.
      ...(counted !== null ? { bytes_done: latest } : {}),
      ...(err instanceof StallError ? { stalls: row.stalls + 1 } : {}),
    });
    throw err;
  } finally {
    countUsage();
  }
}

class UnsupportedHostError extends Error {}

function handleFailure(link: Link, attempts: number, err: unknown, signal: AbortSignal) {
  const message = errorMessage(err);

  if (signal.aborted) {
    // Shutdown: resume next start. User cancel: the UI already wrote the new status.
    const current = getLink(link.id);
    if (current && (current.status === "resolving" || current.status === "downloading")) {
      setLinkStatus(link.id, "queued", { attempts });
    }
    logDebug("download", `Stopped ${link.url} (worker stopping or cancelled); it resumes later`, link.title_id);
    return;
  }
  if (err instanceof HostOfflineError) {
    setLinkStatus(link.id, "offline", { error: message, attempts });
    failLinkFiles(link.id, message);
    logEvent("warn", `Offline: ${link.url} (${message})`, link.title_id, "download");
    linkSettled(link.title_id);
    return;
  }
  if (err instanceof RateLimitError) {
    // Throttling isn't the link's fault, so it doesn't count as an attempt. Other hosts may step in meanwhile.
    const now = clock.now();
    let retryAt = now + err.retryAfterMs;
    if (err.retryAfterMs >= HOST_COOLDOWN_MIN_MS) {
      // Long limits (transfer caps, quotas) are per account/IP: the whole host waits, then resumes from partials.
      const reason = limitReason(link.host, err);
      const limit = recordHostLimit(link.host, retryAt, reason, now);
      retryAt = limit.until;
      if (limit.fresh) {
        logEvent("warn", `${hostLabel(link.host)} limited (${reason}); its downloads resume at ${dateTime(retryAt)}`, null, "host", {
          kind: "host_limited",
          data: { host: link.host, until: retryAt },
        });
      }
    }
    setLinkStatus(link.id, "queued", { error: message, attempts, retryAt });
    parkLinkFiles(link.id);
    // A host-wide cooldown already has its own warning; per-link detail is for debugging.
    logEvent(
      err.retryAfterMs >= HOST_COOLDOWN_MIN_MS ? "debug" : "info",
      `Rate limited by ${link.host}, retrying in ${Math.ceil((retryAt - now) / MINUTE)}m (${message})`,
      link.title_id,
      "host",
    );
    return;
  }

  if (err instanceof UnsupportedHostError) {
    // Sources often list hosts Riparr can't download from yet; set those aside quietly.
    setLinkStatus(link.id, "ignored", { error: `Riparr can't download from ${link.host} yet`, attempts });
    logDebug("download", `Set aside ${link.url}: Riparr can't download from ${link.host}`, link.title_id);
    linkSettled(link.title_id);
    return;
  }

  recordHostError(link.host, message);
  const next = attempts + 1;
  if (err instanceof StallError && next < MAX_ATTEMPTS) {
    // Resume soon from the partial; after repeated stalls mirror selection prefers another host's copy.
    setLinkStatus(link.id, "queued", { error: `Stalled: ${message}`, attempts: next, retryAt: clock.now() + STALL_RETRY_MS });
    parkLinkFiles(link.id);
    logEvent("warn", `Download stalled on ${link.host} (${message}), resuming shortly: ${link.url}`, link.title_id, "download");
    return;
  }
  if (err instanceof NeedsAttentionError || next >= MAX_ATTEMPTS) {
    setLinkStatus(link.id, "failed", { error: message, attempts: next });
    failLinkFiles(link.id, message);
    logEvent("error", `Failed: ${link.url} (${message})`, link.title_id, "download", { kind: "download_failed", data: { host: link.host, url: link.url } });
    const title = getTitle(link.title_id);
    void notify({ event: "download_failed", message: `${link.url}: ${message}`, subject: title && { id: title.id, name: title.name } });
    linkSettled(link.title_id);
    return;
  }
  const delay = retryDelay(next);
  setLinkStatus(link.id, "queued", { error: message, attempts: next, retryAt: clock.now() + delay });
  parkLinkFiles(link.id);
  logEvent("warn", `Attempt ${next}/${MAX_ATTEMPTS} failed for ${link.url}: ${message}; next try in ${Math.ceil(delay / MINUTE)}m`, link.title_id, "download");
  if (err instanceof Error && err.stack) logDebug("download", () => `Stack for ${link.url}: ${err.stack}`, link.title_id);
}

function formatSize(bytes: number) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
