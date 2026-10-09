import path from "node:path";
import PQueue from "p-queue";
import { getContainer, type Container } from "@/lib/containers";
import { downloadsRoot } from "@/lib/db";
import { downloadFile } from "@/lib/download";
import { HostOfflineError, NeedsAttentionError, RateLimitError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import { hostAccount } from "@/lib/host-accounts";
import { findResolver } from "@/lib/hosts";
import type { RemoteFile } from "@/lib/hosts/types";
import {
  containerFiles,
  containersWithActiveLinks,
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
  type Link,
} from "@/lib/links";
import { planMirrors } from "@/lib/mirrors";
import { fetchFor } from "@/lib/net";
import { notify } from "@/lib/notify";
import { renderTemplate, resolveInside } from "@/lib/paths";
import { getSettings } from "@/lib/settings";
import { diskIsLow } from "./disk";
import { linkSettled } from "./extract-runner";

const MINUTE = 60_000;
const MAX_ATTEMPTS = 5;
const PARTIAL_DIR = ".riparr-partial";
const PROGRESS_WRITE_MS = 1_000;
const RESOLVE_CONCURRENCY = 4;

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
  applyConcurrency();

  for (const link of unresolvedLinks()) {
    if (jobs.has(link.id) || shutdown.aborted) continue;
    startJob(link, shutdown, (signal) => resolveQueue.add(() => resolveLink(link, signal)));
  }

  for (const containerId of containersWithActiveLinks()) selectAndSettle(containerId);

  // Running downloads finish; nothing new starts until space is freed.
  if (diskIsLow()) return;
  for (const link of downloadableLinks()) {
    if (jobs.has(link.id) || shutdown.aborted) continue;
    const { globalQueue, hostQueue } = queues(link.host);
    // Host slot first, then a global slot, so one busy host can't starve the rest.
    startJob(link, shutdown, (signal) => hostQueue.add(() => globalQueue.add(() => downloadLink(link, signal))));
  }
}

export function cancelLink(linkId: number) {
  jobs.get(linkId)?.controller.abort();
}

export function cancelContainer(containerId: number) {
  for (const job of jobs.values()) {
    if (job.link.container_id === containerId) job.controller.abort();
  }
}

export function activeJobCount() {
  return jobs.size;
}

/** Mirror selection for one container, then finalizes links whose files are all accounted for. */
export function selectAndSettle(containerId: number, now = Date.now()) {
  // Wait until every freshly found link is resolved, so a quick host doesn't win by default.
  if (resolvingInProgress(containerId)) return;
  const priority = getSettings().hostPriority;
  const plan = planMirrors(containerFiles(containerId), priority, now);
  setFileStatuses(plan.promote, "queued");
  setFileStatuses(plan.standby, "standby");
  settleLinks(containerId, new Set(plan.covered));
}

function settleLinks(containerId: number, covered: Set<number>) {
  const byLink = new Map<number, { status: string; files: { id: number; status: string; name: string }[] }>();
  for (const f of containerFiles(containerId)) {
    if (f.linkStatus !== "queued" || f.linkResolvedAt === null || jobs.has(f.linkId)) continue;
    const entry = byLink.get(f.linkId) ?? { status: f.linkStatus, files: [] };
    entry.files.push({ id: f.fileId, status: f.fileStatus, name: f.name });
    byLink.set(f.linkId, entry);
  }

  const container = getContainer(containerId);
  for (const [linkId, { files }] of byLink) {
    const finished = files.every(
      (f) => f.status === "done" || f.status === "skipped" || (f.status === "standby" && covered.has(f.id)),
    );
    if (!finished) continue;

    const downloaded = files.filter((f) => f.status === "done" || f.status === "skipped");
    const link = getLink(linkId)!;
    if (downloaded.length) {
      setLinkStatus(linkId, "done", { attempts: 0 });
      const names = downloaded.length === 1 ? downloaded[0].name : `${downloaded.length} files`;
      const viaMirrors = downloaded.length < files.length ? ` (${files.length - downloaded.length} from other hosts)` : "";
      logEvent("info", `Downloaded ${names} from ${link.host}${viaMirrors}`, containerId);
      void notify({ event: "download_done", message: `Downloaded ${names}`, container });
    } else {
      setLinkStatus(linkId, "mirror", { attempts: 0 });
      logEvent("info", `Not needed: ${link.url} (its files came from preferred hosts)`, containerId);
    }
    linkSettled(containerId);
  }
}

/** Checks the link is still wanted, returning it with its container. */
function stillWanted(link: Link) {
  // The UI may have changed it (ignored, deleted) while it waited in the queue.
  const current = getLink(link.id);
  const container = current && getContainer(current.container_id);
  if (!current || !container || !container.enabled || !["new", "queued"].includes(current.status)) return null;
  return { current, container };
}

async function resolveFiles(link: Link, container: Container, signal: AbortSignal) {
  const resolver = findResolver(link.url);
  if (!resolver) throw new UnsupportedHostError(`No resolver for ${link.host}`);
  const remote = await resolver.resolve(new URL(link.url), {
    account: hostAccount(resolver.id),
    password: container.password,
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
    await resolveFiles(link, wanted.container, signal);
    markResolved(link.id);
  } catch (err) {
    handleFailure(link, wanted.current.attempts, err, signal);
  }
}

/** Downloads the link's files that mirror selection chose; settling happens on the next pass. */
async function downloadLink(link: Link, signal: AbortSignal) {
  if (signal.aborted) return;
  const wanted = stillWanted(link);
  if (!wanted) return;
  const { current, container } = wanted;
  try {
    setLinkStatus(link.id, "downloading", { attempts: current.attempts });
    // Re-resolve for fresh download handles (tokens, signed URLs).
    const { remote } = await resolveFiles(link, container, signal);
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
      await downloadOne(container, link, row.id, file, signal);
    }
    setLinkStatus(link.id, "queued", { attempts: 0 });
  } catch (err) {
    handleFailure(link, current.attempts, err, signal);
  }
}

async function downloadOne(container: Container, link: Link, fileId: number, file: RemoteFile, signal: AbortSignal) {
  const root = downloadsRoot();
  const relative = renderTemplate(container.path_template, {
    container: container.name,
    host: link.host,
    filename: file.name,
    dir: file.dir,
    date: new Date(link.discovered_at),
  });
  const finalPath = resolveInside(root, path.posix.join(container.target_dir, relative));
  const partialPath = resolveInside(root, path.posix.join(PARTIAL_DIR, `${fileId}.part`));

  updateFile(fileId, { status: "downloading", error: null });
  let lastWrite = 0;
  let lastBytes: number | null = null;
  try {
    const result = await downloadFile(file, {
      finalPath,
      partialPath,
      signal,
      bytesPerSecond: getSettings().bytesPerSecond || null,
      onProgress: (bytes) => {
        const now = Date.now();
        if (now - lastWrite < PROGRESS_WRITE_MS) return;
        // The first sample includes resumed bytes, so speed starts from the second.
        const speed = lastBytes === null ? 0 : Math.round(((bytes - lastBytes) * 1000) / (now - lastWrite));
        lastWrite = now;
        lastBytes = bytes;
        updateFile(fileId, { bytes_done: bytes, speed_bps: Math.max(0, speed) });
      },
    });
    updateFile(fileId, {
      status: result.status,
      local_path: path.relative(root, result.path),
      speed_bps: 0,
      bytes_done: file.size ?? ("bytes" in result ? result.bytes : 0),
    });
  } catch (err) {
    updateFile(fileId, { status: signal.aborted ? "queued" : "failed", error: errorMessage(err), speed_bps: 0 });
    throw err;
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
    return;
  }
  if (err instanceof HostOfflineError) {
    setLinkStatus(link.id, "offline", { error: message, attempts });
    failLinkFiles(link.id, message);
    logEvent("warn", `Offline: ${link.url} (${message})`, link.container_id);
    linkSettled(link.container_id);
    return;
  }
  if (err instanceof RateLimitError) {
    // Throttling isn't the link's fault, so it doesn't count as an attempt. Other hosts may step in meanwhile.
    setLinkStatus(link.id, "queued", { error: message, attempts, retryAt: Date.now() + err.retryAfterMs });
    parkLinkFiles(link.id);
    logEvent("info", `Rate limited by ${link.host}, retrying in ${Math.ceil(err.retryAfterMs / MINUTE)}m`, link.container_id);
    return;
  }

  if (err instanceof UnsupportedHostError) {
    // Containers often list hosts Riparr can't download from yet; set those aside quietly.
    setLinkStatus(link.id, "ignored", { error: `Riparr can't download from ${link.host} yet`, attempts });
    linkSettled(link.container_id);
    return;
  }

  const next = attempts + 1;
  if (err instanceof NeedsAttentionError || next >= MAX_ATTEMPTS) {
    setLinkStatus(link.id, "failed", { error: message, attempts: next });
    failLinkFiles(link.id, message);
    logEvent("error", `Failed: ${link.url} (${message})`, link.container_id);
    void notify({ event: "download_failed", message: `${link.url}: ${message}`, container: getContainer(link.container_id) });
    linkSettled(link.container_id);
    return;
  }
  setLinkStatus(link.id, "queued", { error: message, attempts: next, retryAt: Date.now() + retryDelay(next) });
  parkLinkFiles(link.id);
  logEvent("warn", `Attempt ${next}/${MAX_ATTEMPTS} failed for ${link.url}: ${message}`, link.container_id);
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
