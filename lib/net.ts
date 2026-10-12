import fs from "node:fs";
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

/** True inside a Docker container. */
export function inDocker(): boolean {
  try {
    return fs.existsSync("/.dockerenv");
  } catch {
    return false;
  }
}

/** True for URLs pointing at this machine (127.x, ::1, localhost). */
export function isLoopbackUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "::1" || /^127\./.test(host);
  } catch {
    return false;
  }
}

/**
 * Why a URL can't be used from where Riparr runs, or null. Inside Docker, 127.0.0.1 is Riparr's own
 * container, so a proxy or FlareSolverr at 127.0.0.1 is never reached.
 */
export function loopbackInDockerHint(raw: string, docker = inDocker()): string | null {
  if (!raw || !docker || !isLoopbackUrl(raw)) return null;
  return "Riparr runs in Docker, where 127.0.0.1 is its own container. Use your server's LAN address (e.g. http://192.168.1.10:8888; the service must publish its port on that address, not only on 127.0.0.1) or its container name on a shared network (e.g. http://gluetun:8888).";
}

const REASONS: Record<string, string> = {
  ECONNREFUSED: "connection refused",
  ENOTFOUND: "host not found",
  EAI_AGAIN: "DNS lookup failed",
  ETIMEDOUT: "timed out",
  UND_ERR_CONNECT_TIMEOUT: "timed out connecting",
  ECONNRESET: "connection reset",
  EHOSTUNREACH: "host unreachable",
  ENETUNREACH: "network unreachable",
  CERT_HAS_EXPIRED: "TLS certificate expired",
  ERR_TLS_CERT_ALTNAME_INVALID: "TLS certificate doesn't match the site",
};

/**
 * A readable reason for a failed request. Node's fetch only says "fetch failed"; the cause
 * (refused, not found, timeout…) is underneath. When the address that failed is the proxy,
 * says so, with a hint when it's 127.0.0.1 inside Docker.
 */
export function describeNetworkError(err: unknown, proxyUrl: string | null = proxyUrlSetting() || null): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause as (Error & { code?: string; address?: string; port?: number; hostname?: string }) | undefined;
  if (err.message !== "fetch failed" || !cause) return err.message;
  const code = cause.code ?? "";
  const reason = REASONS[code] ?? cause.message ?? code;
  let proxy: URL | null = null;
  try {
    proxy = proxyUrl ? new URL(proxyUrl) : null;
  } catch {}
  const target = cause.address ? `${cause.address}${cause.port ? `:${cause.port}` : ""}` : (cause.hostname ?? "");
  // Through a proxy, Riparr connects to the proxy, not the site: a failed connection on its host or port is the proxy.
  const atProxy = proxy !== null && (cause.hostname === proxy.hostname || cause.address === proxy.hostname || (cause.port !== undefined && String(cause.port) === proxy.port));
  if (atProxy && proxy) {
    const hint = loopbackInDockerHint(proxy.href);
    return `Can't reach the proxy at ${proxy.host} (${reason})${hint ? `. ${hint}` : ""}`;
  }
  return `Network error${target ? ` reaching ${target}` : ""}: ${reason}`;
}
