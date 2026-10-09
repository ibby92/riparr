import { NeedsAttentionError } from "@/lib/errors";

/**
 * Client for FlareSolverr's v1 API (https://github.com/FlareSolverr/FlareSolverr),
 * which loads a page in a headless browser and waits out Cloudflare/DDoS-Guard
 * challenges. It does not solve captchas.
 *
 *   POST <endpoint>/v1 { cmd: "request.get" | "request.post", url, maxTimeout, postData?, session?, cookies? }
 *   → { status: "ok" | "error", message, solution?: { url, status, response, cookies[], userAgent } }
 *
 * Errors come back as HTTP 500 with `status: "error"`. `solution.status` is
 * always 200 (Selenium can't see it), so callers must look at the HTML.
 */

export type FlareSolverrCookie = { name: string; value: string; domain?: string; expires?: number };

export type FlareSolverrResult = {
  /** Target page's HTTP status as reported by FlareSolverr (currently always 200). */
  status: number;
  html: string;
  /** Final URL after redirects. */
  url: string;
  cookies: FlareSolverrCookie[];
  /** The browser's User-Agent; cf_clearance only works together with it. */
  userAgent: string;
};

export type FlareSolverrOptions = {
  signal: AbortSignal;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** How long FlareSolverr may spend on the challenge. Default 60s. */
  maxTimeoutMs?: number;
  /** Reuse a FlareSolverr browser session (`sessions.create`). */
  session?: string;
  /** Cookies to set in the browser before (re)loading the page. */
  cookies?: { name: string; value: string }[];
};

const DEFAULT_MAX_TIMEOUT_MS = 60_000;
/** Slack on top of maxTimeout for browser start-up and the response round trip. */
const HTTP_GRACE_MS = 15_000;
const TEST_TIMEOUT_MS = 10_000;

/** Accepts `http://host:8191`, `http://host:8191/` and `http://host:8191/v1`; returns the base without a trailing slash. */
export function normalizeFlareSolverrEndpoint(endpoint: string): string {
  let s = endpoint.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error(`Invalid FlareSolverr URL: ${endpoint}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`Invalid FlareSolverr URL: ${endpoint}`);
  u.search = "";
  u.hash = "";
  u.pathname = u.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "").replace(/\/+$/, "");
  return u.href.replace(/\/+$/, "");
}

async function callApi(
  endpoint: string,
  payload: Record<string, unknown>,
  opts: FlareSolverrOptions,
): Promise<FlareSolverrResult> {
  const base = normalizeFlareSolverrEndpoint(endpoint);
  const maxTimeout = opts.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS;
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  let body: unknown;
  try {
    res = await doFetch(`${base}/v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        maxTimeout,
        ...(opts.session ? { session: opts.session } : {}),
        ...(opts.cookies?.length ? { cookies: opts.cookies.map(({ name, value }) => ({ name, value })) } : {}),
      }),
      signal: AbortSignal.any([opts.signal, AbortSignal.timeout(maxTimeout + HTTP_GRACE_MS)]),
    });
    body = await res.json().catch(() => undefined);
  } catch (err) {
    if (opts.signal.aborted) throw err;
    const reason = err instanceof Error && err.name === "TimeoutError" ? "no response in time" : errorText(err);
    throw new Error(`FlareSolverr unreachable at ${base} (${reason})`);
  }

  if (!isRecord(body) || typeof body.status !== "string") {
    throw new Error(`FlareSolverr at ${base} returned an unexpected response (HTTP ${res.status}) — is the URL right?`);
  }
  if (body.status !== "ok") {
    const message = typeof body.message === "string" && body.message ? body.message.replace(/^Error:\s*/, "") : "unknown error";
    throw new NeedsAttentionError(`FlareSolverr couldn't get past the challenge: ${message}`);
  }
  const sol = body.solution;
  if (!isRecord(sol) || typeof sol.response !== "string") {
    throw new Error(`FlareSolverr at ${base} returned no page content`);
  }
  return {
    status: typeof sol.status === "number" ? sol.status : 200,
    html: sol.response,
    url: typeof sol.url === "string" && sol.url ? sol.url : String(payload.url),
    cookies: Array.isArray(sol.cookies)
      ? sol.cookies.filter(isRecord).flatMap((c) =>
          typeof c.name === "string" && typeof c.value === "string"
            ? [
                {
                  name: c.name,
                  value: c.value,
                  ...(typeof c.domain === "string" ? { domain: c.domain } : {}),
                  ...(typeof c.expires === "number" && c.expires > 0 ? { expires: c.expires } : {}),
                },
              ]
            : [],
        )
      : [],
    userAgent: typeof sol.userAgent === "string" ? sol.userAgent : "",
  };
}

/** Loads `url` through FlareSolverr. Throws Error if FlareSolverr is down, NeedsAttentionError if it couldn't solve the page. */
export function flaresolverrGet(endpoint: string, url: string, opts: FlareSolverrOptions): Promise<FlareSolverrResult> {
  return callApi(endpoint, { cmd: "request.get", url }, opts);
}

/**
 * POSTs an urlencoded form through FlareSolverr. Note FlareSolverr decodes
 * `postData` with `unquote` (not `unquote_plus`), so spaces must be `%20`, not `+`.
 */
export function flaresolverrPost(
  endpoint: string,
  url: string,
  postData: string | URLSearchParams,
  opts: FlareSolverrOptions,
): Promise<FlareSolverrResult> {
  return callApi(endpoint, { cmd: "request.post", url, postData: encodePostData(postData) }, opts);
}

export function encodePostData(data: string | URLSearchParams): string {
  if (typeof data === "string") return data;
  return [...data].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

export type FlareSolverrTestResult = { ok: true; version: string } | { ok: false; error: string };

/** For the Settings "Test" button: `GET <endpoint>/` answers `{ msg: "FlareSolverr is ready!", version, userAgent }`. */
export async function testFlareSolverr(
  endpoint: string,
  opts: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<FlareSolverrTestResult> {
  let base: string;
  try {
    base = normalizeFlareSolverrEndpoint(endpoint);
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
  const doFetch = opts.fetch ?? fetch;
  const timeout = AbortSignal.timeout(TEST_TIMEOUT_MS);
  try {
    const res = await doFetch(`${base}/`, {
      headers: { Accept: "application/json" },
      signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    });
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} from ${base}` };
    if (!isRecord(body) || typeof body.msg !== "string" || !/flaresolverr/i.test(body.msg)) {
      return { ok: false, error: `${base} doesn't look like FlareSolverr` };
    }
    return { ok: true, version: typeof body.version === "string" ? body.version : "unknown" };
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "no response in time" : errorText(err);
    return { ok: false, error: `FlareSolverr unreachable at ${base} (${reason})` };
  }
}

// --- Clearance cache ---------------------------------------------------------
// cf_clearance is bound to the User-Agent (and client IP) that solved the
// challenge. We keep FlareSolverr's cookies + UA per origin so later polls can
// fetch directly and only go back to FlareSolverr when challenged again.

export type Clearance = { cookies: FlareSolverrCookie[]; userAgent: string; expiresAt: number };

const DEFAULT_CLEARANCE_TTL_MS = 30 * 60_000;
const MAX_CLEARANCE_TTL_MS = 12 * 60 * 60_000;
const clearances = new Map<string, Clearance>();

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Remembers FlareSolverr's cookies + UA for `url`'s origin. Expiry follows cf_clearance's `expires`, capped at 12h. */
export function rememberClearance(url: string, cookies: FlareSolverrCookie[], userAgent: string, now = Date.now()) {
  const origin = originOf(url);
  if (!origin || !userAgent || !cookies.length) return;
  const cf = cookies.find((c) => c.name === "cf_clearance" || c.name.startsWith("__ddg"));
  const cookieExpiry = cf?.expires ? cf.expires * 1000 : now + DEFAULT_CLEARANCE_TTL_MS;
  const expiresAt = Math.min(cookieExpiry, now + MAX_CLEARANCE_TTL_MS);
  if (expiresAt <= now) return;
  clearances.set(origin, { cookies, userAgent, expiresAt });
}

export function getClearance(url: string, now = Date.now()): Clearance | null {
  const origin = originOf(url);
  const entry = origin ? clearances.get(origin) : undefined;
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    clearances.delete(origin!);
    return null;
  }
  return entry;
}

export function forgetClearance(url: string) {
  const origin = originOf(url);
  if (origin) clearances.delete(origin);
}

/** For tests. */
export function clearClearanceCache() {
  clearances.clear();
}

/** `name=value` pairs of the cookies that apply to `url`'s host. */
export function cookiePairsFor(cookies: FlareSolverrCookie[], url: string): string[] {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return [];
  }
  return cookies
    .filter((c) => {
      if (!c.domain) return true;
      const d = c.domain.replace(/^\./, "").toLowerCase();
      return host === d || host.endsWith(`.${d}`);
    })
    .map((c) => `${c.name}=${c.value}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    return cause instanceof Error && cause.message ? cause.message : err.message;
  }
  return String(err);
}
