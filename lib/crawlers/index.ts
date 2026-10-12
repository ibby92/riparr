import { NeedsAttentionError, RateLimitError } from "@/lib/errors";
import { decryptCrateList, parseCrateLoader } from "./crate-api";
import { cnl2Source, findCnl2Payloads } from "./cnl2";
import { decryptDlc, metaFromFileName, type DlcPackage } from "./dlc";
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

export type { ContainerSource, CrawlOptions, CrawlResult, LinkMeta } from "./types";
export { decryptCnl2 } from "./cnl2";
export { decryptDlc, dlcLinks, DlcError, type DlcPackage } from "./dlc";
export { isKnownHostUrl, KNOWN_HOST_DOMAINS } from "./known-hosts";
export { normalizeFlareSolverrEndpoint, testFlareSolverr } from "./flaresolverr";
export type { FlareSolverrTestResult } from "./flaresolverr";

/** Tried in order; the first to return links wins. */
export const sources: ContainerSource[] = [cnl2Source, plainSource];

const TIMEOUT_MS = 30_000;

const EXPIRED = /\b(?:link|page) has expired\b/i;
const EXPIRED_MSG =
  "This link has expired on the site. Open the show's page there in your browser, copy the new download-page link and paste it with Replace URL on this source";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// Note: /cdn-cgi/challenge-platform/scripts/jsd/… is Cloudflare's passive bot-detection beacon on
// ordinary pages; only the interactive challenge (/challenge-platform/h/…, _cf_chl_opt) counts.
const CHALLENGE =
  /cf-browser-verification|challenges\.cloudflare\.com\/cdn-cgi|\/cdn-cgi\/challenge-platform\/h\/|window\._cf_chl_opt|<title>\s*(?:just a moment\.\.\.|attention required! \| cloudflare)|ddos-guard|<title>\s*ddos-guard/i;
const CAPTCHA =
  /class=["'][^"']*\b(?:g-recaptcha|h-captcha|cf-turnstile|frc-captcha)\b|google\.com\/recaptcha\/|hcaptcha\.com\/1\/api\.js|challenges\.cloudflare\.com\/turnstile|<input[^>]+name=["']?(?:captcha|captcha_code|recaptcha_response_field)\b|id=["']captcha/i;
const WRONG_PASSWORD = /(?:wrong|incorrect|invalid|falsches)\s+(?:password|passwort|pass)/i;
/** Proof-of-work and other "confirm you're human" gates (filecrypt's cutcaptcha) that only a person should pass. */
const HUMAN_CHECK = /class=["'][^"']*\bpow-captcha\b|cutcaptcha\.net|<h2>\s*Security Check\s*<\/h2>/i;
const FILECRYPT_MSG =
  "filecrypt asks for a captcha before it shows this container's links, and Riparr doesn't solve captchas. Open the page in your browser, pass the check, then click Click'n'Load (or download its .dlc and import it on the title). Turn off “Check the page for new links” on this source so Riparr stops trying.";
const PASSWORD_INPUT = /<input\b[^>]*\btype\s*=\s*["']?password\b/i;
const CAPTCHA_MSG = "Captcha required — solve it in a browser and use Click'n'Load";
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
/** The page without HTML comments: commented-out forms (filecrypt keeps an old password field) aren't real. */
function visible(html: string) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

export function detectAttention(html: string, password: string | null, url = ""): string | null {
  if (CHALLENGE.test(html)) return CHALLENGE_MSG;
  const shown = visible(html);
  if (HUMAN_CHECK.test(shown)) return isFilecrypt(url) || /filecrypt/i.test(shown) ? FILECRYPT_MSG : CAPTCHA_MSG;
  if (CAPTCHA.test(shown)) return CAPTCHA_MSG;
  if (PASSWORD_INPUT.test(shown)) {
    if (!password) return "Container is password-protected — set its password";
    return "Container rejected the password";
  }
  return null;
}

/** filecrypt.cc and its mirror domains. */
export function isFilecrypt(url: string): boolean {
  try {
    return /(^|\.)filecrypt\.(cc|co|to|org)$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
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

/** Fetch for the container site itself (possibly proxied); FlareSolverr calls use `opts.fetch`. */
function siteFetch(opts: CrawlOptions): typeof fetch {
  return opts.siteFetch ?? opts.fetch ?? fetch;
}

/** Merges `name=value` lists; later lists win. */
function mergeCookies(...lists: string[][]): string[] {
  const byName = new Map<string, string>();
  for (const list of lists) for (const pair of list) byName.set(pair.split("=")[0], pair);
  return [...byName.values()];
}

async function fetchPage(url: string, opts: CrawlOptions, init: RequestInit = {}, identity = DEFAULT_IDENTITY): Promise<Page> {
  const doFetch = siteFetch(opts);
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
  opts.log?.(`GET ${url} → HTTP ${res.status}, ${Math.round(html.length / 1024)} KB${identity !== DEFAULT_IDENTITY ? " (with FlareSolverr clearance)" : ""}`);
  if (!res.ok) {
    if ((res.status === 403 || res.status === 503 || res.status === 429) && CHALLENGE.test(html)) {
      throw new ChallengeError(CHALLENGE_MSG);
    }
    // Temporary links (mkvdrama's /c/… aliases last about a day): the show is still there, the link isn't.
    if (res.status === 410 && (res.headers.get("x-container-alias-expired") === "1" || EXPIRED.test(html))) {
      throw new NeedsAttentionError(EXPIRED_MSG);
    }
    // The site removed the page: retrying won't help, a person needs to replace or remove the source.
    if (res.status === 404 || res.status === 410) {
      throw new NeedsAttentionError(`This page no longer exists on the site (HTTP ${res.status}); remove this source or replace its URL`);
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

/**
 * Pages whose link list is loaded by script from an encrypted API (mkvdrama-style):
 * fetch and decrypt it like the page would. Null if the page isn't one of these.
 */
async function crawlCrateApi(page: Page, opts: CrawlOptions): Promise<CrawlResult | null> {
  const loader = parseCrateLoader(page.html);
  if (!loader) return null;
  const res = await siteFetch(opts)(new URL(loader.apiPath, page.url), {
    headers: {
      ...HEADERS,
      Accept: "application/json, */*",
      "User-Agent": page.userAgent,
      Referer: page.url,
      ...(page.cookies.length ? { Cookie: page.cookies.join("; ") } : {}),
    },
    signal: AbortSignal.any([opts.signal, AbortSignal.timeout(TIMEOUT_MS)]),
  });
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after")) || 15 * 60;
    throw new RateLimitError(`Container site rate-limited us (retry in ${seconds}s)`, seconds * 1000);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} loading the container's link list`);
  const body = (await res.json().catch(() => null)) as { d?: unknown } | null;
  if (typeof body?.d !== "string") throw new Error("Container's link list has an unexpected format");

  const list = decryptCrateList(body.d, loader.key, loader.iv);
  const seen = new Set<string>();
  const items = list.links.filter((l) => !seen.has(l.url) && seen.add(l.url));
  return { links: items.map((l) => l.url), items, source: "crate-api" };
}

/** Links plus per-file details from decrypted DLC packages. */
function dlcResult(packages: DlcPackage[], source: string): CrawlResult {
  const items = packages.flatMap((p) => p.files).map((f) => ({ url: f.url, ...metaFromFileName(f.name) }));
  const seen = new Set<string>();
  const unique = items.filter((i) => !seen.has(i.url) && seen.add(i.url));
  return { links: unique.map((i) => i.url), items: unique, source };
}

/**
 * viewcrate-style pages: the visible list resolves links one by one through an endpoint
 * that refuses automation, but the site also offers a DLC export for download managers.
 * We poll that export. Null if the page isn't one of these.
 */
async function crawlDlcExport(page: Page, opts: CrawlOptions): Promise<CrawlResult | null> {
  if (!/data-bootstrap-url=["'][^"']+["']/.test(page.html) || !/data-open-base-url=/.test(page.html)) return null;
  const id = new URL(page.url).pathname.split("/").filter(Boolean).pop();
  if (!id || !/^[\w-]+$/.test(id)) return null;
  const headers = {
    ...HEADERS,
    Accept: "application/json",
    "User-Agent": page.userAgent,
    Referer: page.url,
    ...(page.cookies.length ? { Cookie: page.cookies.join("; ") } : {}),
  };
  const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(TIMEOUT_MS)]);
  const res = await siteFetch(opts)(new URL(`/api/dlc_url/${id}`, page.url), { headers, signal });
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after")) || 15 * 60;
    throw new RateLimitError(`Container site rate-limited us (retry in ${seconds}s)`, seconds * 1000);
  }
  const meta = (await res.json().catch(() => null)) as { url?: string; detail?: string; error?: string } | null;
  if (!res.ok || !meta?.url) throw new Error(`Container's DLC export is unavailable${meta?.detail || meta?.error ? `: ${meta.detail ?? meta.error}` : ""}`);

  const file = await siteFetch(opts)(new URL(meta.url, page.url), { headers: { ...headers, Accept: "*/*" }, signal });
  if (!file.ok) throw new Error(`HTTP ${file.status} downloading the container's DLC export`);
  return dlcResult(await decryptDlc(await file.text(), { signal: opts.signal, fetch: opts.fetch }), "dlc-export");
}

/** Downloads the page's DLC file(s) with the page's cookies and decrypts them. */
async function crawlDlc(page: Page, opts: CrawlOptions): Promise<{ result: CrawlResult | null; error: string | null }> {
  let error: string | null = null;
  for (const url of findDlcUrls(page.html, page.url)) {
    try {
      const file = await fetchPage(url, opts, { headers: { Referer: page.url } }, { cookies: page.cookies, userAgent: page.userAgent });
      const result = dlcResult(await decryptDlc(file.html, { signal: opts.signal, fetch: opts.fetch }), "dlc");
      if (result.links.length) return { result, error: null };
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
  if (opts.password && PASSWORD_INPUT.test(visible(page.html))) {
    opts.log?.("Page asks for a password; submitting the source's password");
    const submitted = await submitPassword(page, opts.password, opts, endpoint);
    if (submitted) {
      if (PASSWORD_INPUT.test(submitted.html) || WRONG_PASSWORD.test(submitted.html)) {
        throw new NeedsAttentionError("Container rejected the password");
      }
      page = submitted;
    }
  }

  const crate = (await crawlCrateApi(page, opts)) ?? (await crawlDlcExport(page, opts));
  if (crate) {
    opts.log?.(`Reader ${crate.source}: ${crate.links.length} link(s)${crate.items?.length ? `, ${crate.items.length} with details` : ""}`);
    return crate;
  }
  opts.log?.("No crate-api list or DLC export on the page; trying Click'n'Load, .dlc and plain links");

  const { result, dlcError } = await runSources(page, opts);
  if (result) {
    opts.log?.(`Reader ${result.source}: ${result.links.length} link(s)`);
    return result;
  }
  if (dlcError) opts.log?.(`DLC failed: ${dlcError}`);

  const attention = detectAttention(page.html, opts.password, page.url);
  if (attention) {
    if (attention === CHALLENGE_MSG) throw new ChallengeError(page.via === "flaresolverr" ? FS_CHALLENGE_MSG : CHALLENGE_MSG);
    throw new NeedsAttentionError(attention);
  }
  if (findCnl2Payloads(page.html).length) throw new Error("Found Click'n'Load data but couldn't decrypt it");
  if (dlcError) {
    const hint = dlcError.includes("unreachable") ? "" : " — try Click'n'Load in a browser";
    throw new NeedsAttentionError(`DLC: ${dlcError}${hint}`);
  }
  opts.log?.("No host links found on the page");
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
  if (clearance) opts.log?.(`Reusing FlareSolverr clearance for ${new URL(url).host}`);
  try {
    return await crawlPage(await fetchPage(url, opts, {}, identity), opts, endpoint);
  } catch (err) {
    if (!(err instanceof ChallengeError) || !endpoint) throw err;
    opts.log?.("Page is behind an anti-bot challenge; retrying through FlareSolverr");
    forgetClearance(url);
  }
  const page = await fetchViaFlareSolverr(endpoint, url, opts);
  opts.log?.(`FlareSolverr fetched the page (${Math.round(page.html.length / 1024)} KB)`);
  return crawlPage(page, opts, endpoint);
}
