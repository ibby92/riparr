import { HostOfflineError, RateLimitError } from "@/lib/errors";
import type { RemoteFile } from "./types";

/** Browser-like UA; some hosts (gofile) also bake it into request tokens. */
export const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** Default wait when a host throttles without saying for how long. */
export const DEFAULT_RETRY_MS = 60_000;

/** Host-specific error mapping, tried before the generic status mapping. Return null to fall through. */
export type ErrorMapper = (res: Response) => Promise<Error | null | undefined>;

export type HttpInit = {
  headers?: HeadersInit | (() => HeadersInit);
  fetch?: typeof fetch;
  mapError?: ErrorMapper;
};

function buildHeaders(init: HttpInit | undefined, extra?: Record<string, string>): Headers {
  const raw = typeof init?.headers === "function" ? init.headers() : init?.headers;
  const headers = new Headers(raw);
  if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
  for (const [k, v] of Object.entries(extra ?? {})) headers.set(k, v);
  return headers;
}

/** Parses Retry-After (seconds or HTTP date) into ms, or null. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const secs = Number(value.trim());
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** Maps a non-OK response to a typed error. Consumes or cancels the body. */
export async function httpError(res: Response, mapError?: ErrorMapper): Promise<Error> {
  const mapped = mapError ? await mapError(res) : null;
  if (!res.bodyUsed) await res.body?.cancel().catch(() => {});
  if (mapped) return mapped;
  const where = `${res.status} ${res.statusText}`.trim() + ` from ${new URL(res.url || "http://unknown").host}`;
  if (res.status === 404 || res.status === 410) return new HostOfflineError(`Not found (${where})`);
  const retry = parseRetryAfter(res.headers.get("retry-after"));
  if (res.status === 429) return new RateLimitError(`Rate limited (${where})`, retry ?? DEFAULT_RETRY_MS);
  if (res.status === 503 && retry !== null) return new RateLimitError(`Unavailable (${where})`, retry);
  return new Error(`HTTP ${where}`);
}

/** Start of a `Content-Range: bytes a-b/c` header, or null. */
function contentRangeStart(value: string | null): number | null {
  const m = value?.match(/^bytes\s+(\d+)-/i);
  return m ? Number(m[1]) : null;
}

/** Returns a RemoteFile.open that GETs `url` with `Range: bytes=<offset>-` for resume. */
export function httpOpener(url: string, init?: HttpInit): RemoteFile["open"] {
  return async (offset, signal) => {
    const headers = buildHeaders(init, offset > 0 ? { range: `bytes=${offset}-` } : undefined);
    const res = await (init?.fetch ?? fetch)(url, { headers, signal, redirect: "follow" });
    if (!res.ok) throw await httpError(res, init?.mapError);
    if (!res.body) throw new Error(`Empty body from ${new URL(url).host}`);
    const start = res.status === 206 ? (contentRangeStart(res.headers.get("content-range")) ?? offset) : 0;
    return { body: res.body, offset: start };
  };
}

export type JsonInit = HttpInit & {
  method?: string;
  body?: BodyInit;
  signal?: AbortSignal;
};

/** Fetches and parses JSON with the same error mapping as httpOpener. */
export async function fetchJson<T = unknown>(url: string, init?: JsonInit): Promise<T> {
  const headers = buildHeaders(init, { accept: "application/json" });
  const res = await (init?.fetch ?? fetch)(url, {
    method: init?.method ?? "GET",
    body: init?.body,
    headers,
    signal: init?.signal,
    redirect: "follow",
  });
  if (!res.ok) throw await httpError(res, init?.mapError);
  return (await res.json()) as T;
}

/** Reads a response body as JSON without throwing; null if it isn't JSON. */
export async function readJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
