import { dueContainers, recordCheck, type Container } from "@/lib/containers";
import { logEvent } from "@/lib/events";
import { notify } from "@/lib/notify";
import { checkContainer } from "./check";

const MINUTE = 60_000;
const MAX_BACKOFF_MS = 6 * 60 * MINUTE;

// Consecutive failures per container, for backoff. Resets when the worker restarts.
const failures = new Map<number, number>();
const inFlight = new Set<number>();

/** Next check time: the poll interval ±10% jitter, doubled per consecutive failure. */
export function nextCheckAt(container: Container, failureCount: number, now = Date.now()) {
  const base = container.poll_interval_min * MINUTE;
  const backoff = failureCount > 0 ? Math.min(base * 2 ** failureCount, MAX_BACKOFF_MS) : base;
  const delay = Math.max(backoff, base);
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return now + Math.round(delay + jitter);
}

export function runDueChecks(signal: AbortSignal) {
  for (const container of dueContainers()) {
    if (inFlight.has(container.id) || signal.aborted) continue;
    inFlight.add(container.id);
    void check(container, signal).finally(() => inFlight.delete(container.id));
  }
}

async function check(container: Container, signal: AbortSignal) {
  try {
    const result = await checkContainer(container, signal);
    const failed = result.status === "error";
    const count = failed ? (failures.get(container.id) ?? 0) + 1 : 0;
    failures.set(container.id, count);

    recordCheck(container.id, {
      status: result.status,
      error: result.error,
      changed: result.newLinks > 0,
      nextCheckAt: nextCheckAt(container, count),
    });
    if (failed) {
      logEvent("error", `Check failed: ${result.error}`, container.id);
    } else if (result.status === "needs_attention" && container.status !== "needs_attention") {
      logEvent("warn", result.error ?? "Needs attention", container.id);
      void notify({ event: "needs_attention", message: result.error ?? "Needs attention", container });
    } else if (result.newLinks > 0) {
      logEvent("info", `Found ${result.newLinks} new link(s) via ${result.source}`, container.id);
      void notify({ event: "new_links", message: `Found ${result.newLinks} new link(s)`, container });
    }
  } catch (err) {
    if (signal.aborted) return;
    const message = err instanceof Error ? err.message : String(err);
    const count = (failures.get(container.id) ?? 0) + 1;
    failures.set(container.id, count);
    recordCheck(container.id, {
      status: "error",
      error: message,
      changed: false,
      nextCheckAt: nextCheckAt(container, count),
    });
    logEvent("error", `Check failed: ${message}`, container.id);
  }
}
