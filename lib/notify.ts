import { getSettings, NOTIFY_EVENTS, type NotifyEvent } from "./settings";

export type Notification = {
  event: NotifyEvent | "test";
  message: string;
  container?: { id: number; name: string } | null;
};

const TIMEOUT_MS = 10_000;

function isDiscord(url: URL) {
  return /(^|\.)discord(app)?\.com$/.test(url.hostname) && url.pathname.startsWith("/api/webhooks/");
}

async function post(url: string, body: unknown, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
}

/**
 * Sends a notification to the configured webhook and/or Apprise endpoint if
 * the event is enabled (test notifications always go). Resolves to the errors
 * per target; never throws.
 */
export async function notify(n: Notification, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const settings = getSettings();
  if (n.event !== "test" && !settings.notifyEvents.includes(n.event)) return [];

  const title = n.event === "test" ? "Riparr test notification" : `Riparr: ${NOTIFY_EVENTS[n.event]}`;
  const body = n.container ? `${n.container.name}: ${n.message}` : n.message;
  // Callers may pass a full container row; only id and name ever leave the box.
  const container = n.container ? { id: n.container.id, name: n.container.name } : null;
  const sends: Promise<void>[] = [];

  if (settings.notifyWebhookUrl) {
    const url = new URL(settings.notifyWebhookUrl);
    sends.push(
      post(
        settings.notifyWebhookUrl,
        isDiscord(url)
          ? { username: "Riparr", content: `**${title}**\n${body}` }
          : { event: n.event, title, message: n.message, container, timestamp: new Date().toISOString() },
        fetchImpl,
      ),
    );
  }
  if (settings.notifyAppriseUrl) {
    const type = n.event === "download_failed" ? "failure" : n.event === "needs_attention" ? "warning" : "info";
    sends.push(post(settings.notifyAppriseUrl, { title, body, type }, fetchImpl));
  }

  const results = await Promise.allSettled(sends);
  const errors = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : []));
  for (const e of errors) console.error(`[riparr] notification failed: ${e}`);
  return errors;
}
