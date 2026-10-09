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
  claimableLinks,
  getLink,
  setLinkStatus,
  updateFile,
  upsertFiles,
  type Link,
} from "@/lib/links";
import { renderTemplate, resolveInside } from "@/lib/paths";
import { getSettings } from "@/lib/settings";

const MINUTE = 60_000;
const MAX_ATTEMPTS = 5;
const PARTIAL_DIR = ".riparr-partial";
const PROGRESS_WRITE_MS = 1_000;

type Job = { link: Link; controller: AbortController };

const jobs = new Map<number, Job>();
const hostQueues = new Map<string, PQueue>();
let globalQueue: PQueue | undefined;

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

/** Queues every claimable link that isn't already in flight. */
export function scheduleDownloads(shutdown: AbortSignal) {
  applyConcurrency();
  for (const link of claimableLinks()) {
    if (jobs.has(link.id) || shutdown.aborted) continue;
    const controller = new AbortController();
    const signal = AbortSignal.any([shutdown, controller.signal]);
    jobs.set(link.id, { link, controller });

    const { globalQueue, hostQueue } = queues(link.host);
    // Host slot first, then a global slot, so one busy host can't starve the rest.
    void hostQueue
      .add(() => globalQueue.add(() => processLink(link, signal)))
      .finally(() => jobs.delete(link.id));
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

async function processLink(link: Link, signal: AbortSignal) {
  if (signal.aborted) return;
  // The UI may have changed it (ignored, deleted) while it waited in the queue.
  const current = getLink(link.id);
  const container = current && getContainer(current.container_id);
  if (!current || !container || !container.enabled || !["new", "queued"].includes(current.status)) return;

  const resolver = findResolver(link.url);
  if (!resolver) {
    setLinkStatus(link.id, "failed", { error: `No resolver for ${link.host}`, attempts: MAX_ATTEMPTS });
    logEvent("warn", `Unsupported host ${link.host}: ${link.url}`, link.container_id);
    return;
  }

  try {
    setLinkStatus(link.id, "resolving", { attempts: current.attempts });
    const remote = await resolver.resolve(new URL(link.url), {
      account: hostAccount(resolver.id),
      password: container.password,
      signal,
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
    setLinkStatus(link.id, "downloading", { attempts: current.attempts });

    for (const file of remote) {
      const row = rows.find((r) => r.key === file.key)!;
      if (row.status === "done" || row.status === "skipped") continue;
      await downloadOne(container, link, row.id, file, signal);
    }

    setLinkStatus(link.id, "done", { attempts: 0 });
    const names = remote.length === 1 ? remote[0].name : `${remote.length} files`;
    logEvent("info", `Downloaded ${names}`, link.container_id);
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
  try {
    const result = await downloadFile(file, {
      finalPath,
      partialPath,
      signal,
      bytesPerSecond: getSettings().bytesPerSecond || null,
      onProgress: (bytes) => {
        const now = Date.now();
        if (now - lastWrite < PROGRESS_WRITE_MS) return;
        lastWrite = now;
        updateFile(fileId, { bytes_done: bytes });
      },
    });
    updateFile(fileId, {
      status: result.status,
      local_path: path.relative(root, result.path),
      bytes_done: file.size ?? ("bytes" in result ? result.bytes : 0),
    });
  } catch (err) {
    updateFile(fileId, { status: signal.aborted ? "queued" : "failed", error: errorMessage(err) });
    throw err;
  }
}

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
    logEvent("warn", `Offline: ${link.url} (${message})`, link.container_id);
    return;
  }
  if (err instanceof RateLimitError) {
    // Throttling isn't the link's fault, so it doesn't count as an attempt.
    setLinkStatus(link.id, "queued", { error: message, attempts, retryAt: Date.now() + err.retryAfterMs });
    logEvent("info", `Rate limited by ${link.host}, retrying in ${Math.ceil(err.retryAfterMs / MINUTE)}m`, link.container_id);
    return;
  }

  const next = attempts + 1;
  if (err instanceof NeedsAttentionError || next >= MAX_ATTEMPTS) {
    setLinkStatus(link.id, "failed", { error: message, attempts: next });
    logEvent("error", `Failed: ${link.url} (${message})`, link.container_id);
    return;
  }
  setLinkStatus(link.id, "queued", { error: message, attempts: next, retryAt: Date.now() + retryDelay(next) });
  logEvent("warn", `Attempt ${next}/${MAX_ATTEMPTS} failed for ${link.url}: ${message}`, link.container_id);
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
