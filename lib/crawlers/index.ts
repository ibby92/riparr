import { NeedsAttentionError } from "@/lib/errors";
import { cnl2Source, findCnl2Payloads } from "./cnl2";
import { decryptDlc, dlcLinks } from "./dlc";
import {
  cookiePairsFor,
  flaresolverrGet,
  flaresolverrPost,
  forgetClearance,
  getClearance,
  rememberClearance,
} from "./flaresolverr";
import { parseAttrs } from "./html";
import { extractHostLinks, plainSource } from "./plain";
import type { ContainerSource, CrawlOptions, CrawlResult } from "./types";

export type { ContainerSource, CrawlOptions, CrawlResult } from "./types";
export { decryptCnl2 } from "./cnl2";
export { decryptDlc, dlcLinks, DlcError, type DlcPackage } from "./dlc";
export { isKnownHostUrl, KNOWN_HOST_DOMAINS } from "./known-hosts";
export { normalizeFlareSolverrEndpoint, testFlareSolverr } from "./flaresolverr";
export type { FlareSolverrTestResult } from "./flaresolverr";

/** Tried in order; the first to return links wins. */
export const sources: ContainerSource[] = [cnl2Source, plainSource];

const TIMEOUT_MS = 30_000;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const CHALLENGE =
  /cf-browser-verification|challenges\.cloudflare\.com\/cdn-cgi|\/cdn-cgi\/challenge-platform|window\._cf_chl_opt|<title>\s*(?:just a moment\.\.\.|attention required! \| cloudflare)|ddos-guard|<title>\s*ddos-guard/i;
const CAPTCHA =
  /class=["'][^"']*\b(?:g-recaptcha|h-captcha|cf-turnstile|frc-captcha)\b|google\.com\/recaptcha\/|hcaptcha\.com\/1\/api\.js|challenges\.cloudflare\.com\/turnstile|<input[^>]+name=["']?(?:captcha|captcha_code|recaptcha_response_field)\b|id=["']captcha/i;
const WRONG_PASSWORD = /(?:wrong|incorrect|invalid|falsches)\s+(?:password|passwort|pass)/i;
const PASSWORD_INPUT = /<input\b[^>]*\btype\s*=\s*["']?password\b/i;
const CHALLENGE_MSG =
  "Blocked by an anti-bot challenge (Cloudflare/DDoS-Guard) — configure FlareSolverr in Settings, or open the container in a browser";
const FS_CHALLENGE_MSG =
  "Still blocked by an anti-bot challenge after going through FlareSolverr — open the container in a browser";
const DLC_HREF = /href\s*=\s*["']?([^"'\s>]*\.dlc(?:[?#][^"'\s>]*)?)(?=["'\s>])/gi;
// filecrypt-style buttons: DownloadDLC('<id>') -> /DLC/<id>.dlc
const DLC_JS = /DownloadDLC\(\s*["']([\w-]+)["']\s*\)/gi;

/** Absolute URLs of `.dlc` files offered by the page. */
export function findDlcUrls(html: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const add = (href: string) => {
    try {
      const u = new URL(href.replace(/&amp;/g, "&"), baseUrl);
      if (u.protocol === "http:" || u.protocol === "https:") urls.add(u.href);
    } catch {}
  };
  for (const m of html.matchAll(DLC_HREF)) add(m[1]);
  for (const m of html.matchAll(DLC_JS)) add(`/DLC/${m[1]}.dlc`);
  return [...urls];
}

/** Human-readable reason the page needs a person, or null. */
export function detectAttention(html: string, password: string | null): string | null {
  if (CHALLENGE.test(html)) return CHALLENGE_MSG;
  if (CAPTCHA.test(html)) return "Captcha required — solve it in a browser and use Click'n'Load";
  if (PASSWORD_INPUT.test(html)) {
    if (!password) return "Container is password-protected — set its password";
    return "Container rejected the password";
  }
  return null;
}

/** An anti-bot challenge (not a captcha) — the kind FlareSolverr can get past. */
class ChallengeError extends NeedsAttentionError {}

type Page = {
  html: string;
  url: string;
  /** `name=value` pairs to send with follow-up requests (password submit). */
  cookies: string[];
  userAgent: string;
  via: "direct" | "flaresolverr";
};

type Identity = { cookies: string[]; userAgent: string };

const DEFAULT_IDENTITY: Identity = { cookies: [], userAgent: HEADERS["User-Agent"] };

/** Merges `name=value` lists; later lists win. */
function mergeCookies(...lists: string[][]): string[] {
  const byName = new Map<string, string>();
  for (const list of lists) for (const pair of list) byName.set(pair.split("=")[0], pair);
  return [...byName.values()];
}

async function fetchPage(url: string, opts: CrawlOptions, init: RequestInit = {}, identity = DEFAULT_IDENTITY): Promise<Page> {
  const doFetch = opts.fetch ?? fetch;
  const res = await doFetch(url, {
    redirect: "follow",
    ...init,
    headers: {
      ...HEADERS,
      "User-Agent": identity.userAgent,
      ...(identity.cookies.length ? { Cookie: identity.cookies.join("; ") } : {}),
      ...(init.headers as Record<string, string>),
    },
    signal: AbortSignal.any([opts.signal, AbortSignal.timeout(TIMEOUT_MS)]),
  });
  const html = await res.text();
  if (!res.ok) {
    if ((res.status === 403 || res.status === 503 || res.status === 429) && CHALLENGE.test(html)) {
      throw new ChallengeError(CHALLENGE_MSG);
    }
    throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""} fetching ${url}`);
  }
  const setCookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0].trim()).filter(Boolean);
  return {
    html,
    url: res.url || url,
    cookies: mergeCookies(identity.cookies, setCookies),
    userAgent: identity.userAgent,
    via: "direct",
  };
}

/**
 * Loads `url` through FlareSolverr and caches its clearance cookies + UA for the origin.
 * `form` POSTs (request.post) or GETs with the given cookies set in the browser first.
 */
async function fetchViaFlareSolverr(
  endpoint: string,
  url: string,
  opts: CrawlOptions,
  form?: { method: "get" | "post"; body: URLSearchParams; cookies: string[] },
): Promise<Page> {
  const fsOpts = {
    signal: opts.signal,
    fetch: opts.fetch,
    cookies: form?.cookies.map((pair) => {
      const i = pair.indexOf("=");
      return { name: pair.slice(0, i), value: pair.slice(i + 1) };
    }),
  };
  const r =
    form?.method === "post"
      ? await flaresolverrPost(endpoint, url, form.body, fsOpts)
      : await flaresolverrGet(endpoint, url, fsOpts);
  if (r.status >= 400) {
    if (CHALLENGE.test(r.html)) throw new ChallengeError(FS_CHALLENGE_MSG);
    throw new Error(`HTTP ${r.status} fetching ${url} (via FlareSolverr)`);
  }
  const pageUrl = r.url || url;
  rememberClearance(pageUrl, r.cookies, r.userAgent);
  return {
    html: r.html,
    url: pageUrl,
    cookies: cookiePairsFor(r.cookies, pageUrl),
    userAgent: r.userAgent || HEADERS["User-Agent"],
    via: "flaresolverr",
  };
}

/** A 200 page that is a challenge interstitial rather than content. */
function isChallengePage(html: string, url: string) {
  return CHALLENGE.test(html) && !extractHostLinks(html, url).length && !findCnl2Payloads(html).length;
}

/**
 * Submits the page's password form with `password`. Returns null if the page has no such form.
 *
 * Always tries a direct request first, reusing the page's cookies and User-Agent — for a page
 * that came through FlareSolverr that includes cf_clearance, which Cloudflare honours for the
 * same UA + IP. Only if that is challenged again does the form go through FlareSolverr
 * (whose browser starts fresh per request, so the session cookies are passed along).
 */
async function submitPassword(page: Page, password: string, opts: CrawlOptions, endpoint: string | null) {
  const form = [...page.html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi)].find((f) => PASSWORD_INPUT.test(f[0]));
  if (!form) return null;
  const formAttrs = parseAttrs(form[0].match(/<form\b[^>]*>/i)![0]);
  const body = new URLSearchParams();
  for (const input of form[0].matchAll(/<(?:input|button)\b[^>]*>/gi)) {
    const a = parseAttrs(input[0]);
    if (!a.name) continue;
    const type = (a.type ?? "text").toLowerCase();
    if (type === "password") body.set(a.name, password);
    else if (type === "checkbox" || type === "radio") {
      if ("checked" in a) body.append(a.name, a.value ?? "on");
    } else if (type !== "submit" && type !== "button" && type !== "image") body.append(a.name, a.value ?? "");
  }
  const action = new URL(formAttrs.action || page.url, page.url).href;
  const method = (formAttrs.method ?? "get").toLowerCase() === "post" ? "post" : "get";
  const identity = { cookies: page.cookies, userAgent: page.userAgent };
  const headers: Record<string, string> = { Referer: page.url };
  let target = action;
  if (method === "get") {
    const u = new URL(action);
    u.search = body.toString();
    target = u.href;
  }

  try {
    const submitted =
      method === "post"
        ? await fetchPage(
            action,
            opts,
            { method: "POST", body: body.toString(), headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" } },
            identity,
          )
        : await fetchPage(target, opts, { headers }, identity);
    if (!endpoint || !isChallengePage(submitted.html, submitted.url)) return submitted;
  } catch (err) {
    if (!(err instanceof ChallengeError) || !endpoint) throw err;
  }
  forgetClearance(action);
  return fetchViaFlareSolverr(endpoint, method === "post" ? action : target, opts, {
    method,
    body,
    cookies: page.cookies,
  });
}

/** Downloads the page's DLC file(s) with the page's cookies and decrypts them. */
async function crawlDlc(page: Page, opts: CrawlOptions): Promise<{ result: CrawlResult | null; error: string | null }> {
  let error: string | null = null;
  for (const url of findDlcUrls(page.html, page.url)) {
    try {
      const file = await fetchPage(url, opts, { headers: { Referer: page.url } }, { cookies: page.cookies, userAgent: page.userAgent });
      const links = dlcLinks(await decryptDlc(file.html, { signal: opts.signal, fetch: opts.fetch }));
      if (links.length) return { result: { links, source: "dlc" }, error: null };
    } catch (err) {
      if (opts.signal.aborted) throw err;
      error = err instanceof Error ? err.message : String(err);
    }
  }
  return { result: null, error };
}

/** Click'n'Load first, then DLC, then any plain host links on the page. */
async function runSources(page: Page, opts: CrawlOptions): Promise<{ result: CrawlResult | null; dlcError: string | null }> {
  const cnl = await cnl2Source.crawl(page.url, page.html, opts);
  if (cnl?.links.length) return { result: cnl, dlcError: null };
  const dlc = await crawlDlc(page, opts);
  if (dlc.result) return { result: dlc.result, dlcError: null };
  for (const source of sources.filter((s) => s !== cnl2Source)) {
    const result = await source.crawl(page.url, page.html, opts);
    if (result?.links.length) return { result, dlcError: null };
  }
  return { result: null, dlcError: dlc.error };
}

/** Password form, sources and attention checks on an already-fetched page. */
async function crawlPage(page: Page, opts: CrawlOptions, endpoint: string | null): Promise<CrawlResult> {
  if (opts.password && PASSWORD_INPUT.test(page.html)) {
    const submitted = await submitPassword(page, opts.password, opts, endpoint);
    if (submitted) {
      if (PASSWORD_INPUT.test(submitted.html) || WRONG_PASSWORD.test(submitted.html)) {
        throw new NeedsAttentionError("Container rejected the password");
      }
      page = submitted;
    }
  }

  const { result, dlcError } = await runSources(page, opts);
  if (result) return result;

  const attention = detectAttention(page.html, opts.password);
  if (attention) {
    if (attention === CHALLENGE_MSG) throw new ChallengeError(page.via === "flaresolverr" ? FS_CHALLENGE_MSG : CHALLENGE_MSG);
    throw new NeedsAttentionError(attention);
  }
  if (findCnl2Payloads(page.html).length) throw new Error("Found Click'n'Load data but couldn't decrypt it");
  if (dlcError) {
    const hint = dlcError.includes("unreachable") ? "" : " — try Click'n'Load in a browser";
    throw new NeedsAttentionError(`DLC: ${dlcError}${hint}`);
  }
  return { links: [], source: "none" };
}

/**
 * Fetches a container page and extracts its host links. Throws NeedsAttentionError
 * for captchas, challenges and password problems; an empty container is `{ links: [], source: "none" }`.
 *
 * With `flaresolverrUrl`, a challenged page is retried through FlareSolverr. Its clearance
 * cookies + UA are cached per origin, so later polls go direct until challenged again.
 */
export async function crawlContainer(url: string, opts: CrawlOptions): Promise<CrawlResult> {
  const endpoint = opts.flaresolverrUrl?.trim() || null;
  const clearance = endpoint ? getClearance(url) : null;
  const identity = clearance
    ? { cookies: cookiePairsFor(clearance.cookies, url), userAgent: clearance.userAgent }
    : DEFAULT_IDENTITY;
  try {
    return await crawlPage(await fetchPage(url, opts, {}, identity), opts, endpoint);
  } catch (err) {
    if (!(err instanceof ChallengeError) || !endpoint) throw err;
    forgetClearance(url);
  }
  return crawlPage(await fetchViaFlareSolverr(endpoint, url, opts), opts, endpoint);
}
