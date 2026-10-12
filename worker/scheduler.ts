import { dueSources, recordCheck, type SourceWithTitle } from "@/lib/sources";
import { RateLimitError } from "@/lib/errors";
import { logDebug, logEvent } from "@/lib/events";
import { notify } from "@/lib/notify";
import { scanTitle } from "@/lib/disk-scan";
import { checkSource } from "./check";

const MINUTE = 60_000;
const MAX_BACKOFF_MS = 6 * 60 * MINUTE;

// Consecutive failures per source, for backoff. Resets when the worker restarts.
const failures = new Map<number, number>();
const inFlight = new Set<number>();

/** Next check time: the poll interval ±10% jitter, doubled per consecutive failure. */
export function nextCheckAt(source: Pick<SourceWithTitle, "poll_interval_min">, failureCount: number, now = Date.now()) {
  const base = source.poll_interval_min * MINUTE;
  const backoff = failureCount > 0 ? Math.min(base * 2 ** failureCount, MAX_BACKOFF_MS) : base;
  const delay = Math.max(backoff, base);
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return now + Math.round(delay + jitter);
}

/** Failures this many times in a row are errors; before that, warnings (Riparr retries with backoff). */
const FAILURES_FOR_ERROR = 3;

function logCheckFailure(message: string, consecutive: number, titleId: number) {
  const retry = consecutive >= FAILURES_FOR_ERROR ? `failed ${consecutive} times in a row` : "will retry";
  const persistent = consecutive >= FAILURES_FOR_ERROR;
  // One failed check is log detail; one that keeps failing is a problem worth showing in History.
  logEvent(persistent ? "error" : "warn", `Check failed (${retry}): ${message}`, titleId, "check", persistent ? { kind: "check_failed" } : undefined);
}

export function runDueChecks(signal: AbortSignal) {
  for (const source of dueSources()) {
    if (inFlight.has(source.id) || signal.aborted) continue;
    inFlight.add(source.id);
    void check(source, signal).finally(() => inFlight.delete(source.id));
  }
}

async function check(source: SourceWithTitle, signal: AbortSignal) {
  // Events and notifications are about the title the source feeds.
  const title = { id: source.title_id, name: source.title_name };
  try {
    const result = await checkSource(source, signal);
    const failed = result.status === "error";
    const count = failed ? (failures.get(source.id) ?? 0) + 1 : 0;
    failures.set(source.id, count);

    const next = nextCheckAt(source, count);
    recordCheck(source.id, {
      status: result.status,
      error: result.error,
      changed: result.newLinks > 0,
      nextCheckAt: next,
    });
    logDebug("check", () => `Next check of ${source.url} in ${Math.round((next - Date.now()) / 60_000)} min${count ? ` (backing off after ${count} failure(s))` : ""}`, title.id);
    if (failed) {
      logCheckFailure(result.error ?? "unknown error", count, title.id);
    } else if (result.status === "needs_attention" && source.status !== "needs_attention") {
      logEvent("warn", result.error ?? "Needs attention", title.id, "check", { kind: "needs_attention", data: { url: source.url } });
      void notify({ event: "needs_attention", message: result.error ?? "Needs attention", subject: title });
    } else if (result.newLinks > 0) {
      // Before mirror selection decides what to download, see what's already in the folder.
      scanTitle(title.id);
      logEvent("info", `Found ${result.newLinks} new link(s) via ${result.source}`, title.id, "check", {
        kind: "links_found",
        data: { count: result.newLinks, via: result.source, url: source.url },
      });
      void notify({ event: "new_links", message: `Found ${result.newLinks} new link(s)`, subject: title });
    }
  } catch (err) {
    if (signal.aborted) return;
    if (err instanceof RateLimitError) {
      // The site asked us to slow down: check again when it says, without counting a failure.
      recordCheck(source.id, {
        status: source.status === "pending" ? "ok" : source.status,
        error: null,
        changed: false,
        nextCheckAt: Date.now() + err.retryAfterMs + Math.round(Math.random() * 30_000),
      });
      logEvent("info", `${err.message}; checking again later`, title.id, "check");
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const count = (failures.get(source.id) ?? 0) + 1;
    failures.set(source.id, count);
    recordCheck(source.id, {
      status: "error",
      error: message,
      changed: false,
      nextCheckAt: nextCheckAt(source, count),
    });
    logCheckFailure(message, count, title.id);
  }
}
