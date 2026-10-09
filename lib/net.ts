import { fetch as undiciFetch, ProxyAgent, Socks5ProxyAgent, type Dispatcher } from "undici";
import { getSettings } from "./settings";

/**
 * Outbound proxy (e.g. gluetun's HTTP proxy, or a VPN provider's SOCKS5
 * server) for reaching container sites that the local network blocks.
 *
 *   containers: only container pages, their link APIs and DLC files go through it
 *   all:        host APIs and downloads too (MEGA excepted: its client has its own transport)
 */
export type ProxyScope = "containers" | "all";

const MASK = "••••••••";

export function proxyUrlSetting(): string {
  return getSettings().proxyUrl || process.env.RIPARR_PROXY_URL || "";
}

/** Validates a proxy URL; returns an error message or null. */
export function proxyUrlError(raw: string): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Not a valid URL";
  }
  if (!["http:", "https:", "socks5:", "socks5h:"].includes(u.protocol)) return "Use http://, https:// or socks5://";
  if (!u.hostname || !u.port) return "Include the host and port, e.g. http://gluetun:8888";
  return null;
}

/** The URL with its password hidden, for showing in the UI. */
export function maskProxyUrl(raw: string): string {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.password) u.password = MASK;
    const shown = u.toString().replace(encodeURIComponent(MASK), MASK);
    return raw.endsWith("/") ? shown : shown.replace(/\/$/, "");
  } catch {
    return raw;
  }
}

/** Restores the stored password when the form sends back the masked URL unchanged. */
export function unmaskProxyUrl(submitted: string, stored: string): string {
  if (!submitted.includes(MASK)) return submitted;
  try {
    const password = new URL(stored).password;
    return submitted.replace(MASK, password);
  } catch {
    return submitted.replace(MASK, "");
  }
}

let cached: { url: string; dispatcher: Dispatcher } | null = null;

function dispatcherFor(url: string): Dispatcher {
  if (cached?.url === url) return cached.dispatcher;
  void cached?.dispatcher.close();
  const u = new URL(url);
  const username = decodeURIComponent(u.username) || undefined;
  const password = decodeURIComponent(u.password) || undefined;
  let dispatcher: Dispatcher;
  if (u.protocol.startsWith("socks5")) {
    dispatcher = new Socks5ProxyAgent(`socks5://${u.host}`, { username, password });
  } else {
    const token = username ? `Basic ${Buffer.from(`${username}:${password ?? ""}`).toString("base64")}` : undefined;
    u.username = "";
    u.password = "";
    dispatcher = new ProxyAgent({ uri: u.toString(), token });
  }
  cached = { url, dispatcher };
  return dispatcher;
}

/** A fetch that goes through the given proxy URL. */
export function proxiedFetch(url: string): typeof fetch {
  const dispatcher = dispatcherFor(url);
  return ((input: string | URL, init?: RequestInit) =>
    undiciFetch(input, { ...(init as object), dispatcher } as Parameters<typeof undiciFetch>[1])) as unknown as typeof fetch;
}

/** Public IP as seen through `fetchImpl` (for the settings page test). */
export async function publicIp(fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`IP check failed (HTTP ${res.status})`);
  return ((await res.json()) as { ip: string }).ip;
}

/** The fetch to use for container sites or file hosts, honouring the proxy settings. */
export function fetchFor(purpose: "container" | "host"): typeof fetch {
  const url = proxyUrlSetting();
  if (!url || proxyUrlError(url)) return fetch;
  if (purpose === "host" && getSettings().proxyScope !== "all") return fetch;
  return proxiedFetch(url);
}
