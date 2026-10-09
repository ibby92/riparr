import { NeedsAttentionError } from "@/lib/errors";
import { cnl2Source, findCnl2Payloads } from "./cnl2";
import { parseAttrs } from "./html";
import { plainSource } from "./plain";
import type { ContainerSource, CrawlOptions, CrawlResult } from "./types";

export type { ContainerSource, CrawlOptions, CrawlResult } from "./types";
export { decryptCnl2 } from "./cnl2";
export { isKnownHostUrl, KNOWN_HOST_DOMAINS } from "./known-hosts";

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
const DLC_LINK = /href\s*=\s*["']?[^"'\s>]*\.dlc\b|DownloadDLC\(/i;

/** Human-readable reason the page needs a person, or null. */
export function detectAttention(html: string, password: string | null): string | null {
  if (CHALLENGE.test(html)) return "Blocked by an anti-bot challenge (Cloudflare/DDoS-Guard) — open the container in a browser";
  if (CAPTCHA.test(html)) return "Captcha required — solve it in a browser and use Click'n'Load";
  if (PASSWORD_INPUT.test(html)) {
    if (!password) return "Container is password-protected — set its password";
    return "Container rejected the password";
  }
  return null;
}

async function fetchPage(url: string, opts: CrawlOptions, init: RequestInit = {}) {
  const doFetch = opts.fetch ?? fetch;
  const res = await doFetch(url, {
    redirect: "follow",
    ...init,
    headers: { ...HEADERS, ...(init.headers as Record<string, string>) },
    signal: AbortSignal.any([opts.signal, AbortSignal.timeout(TIMEOUT_MS)]),
  });
  const html = await res.text();
  if (!res.ok) {
    if ((res.status === 403 || res.status === 503 || res.status === 429) && CHALLENGE.test(html)) {
      throw new NeedsAttentionError(
        "Blocked by an anti-bot challenge (Cloudflare/DDoS-Guard) — open the container in a browser",
      );
    }
    throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""} fetching ${url}`);
  }
  return { html, url: res.url || url, cookies: res.headers.getSetCookie?.() ?? [] };
}

/** Submits the page's password form with `password`. Returns null if the page has no such form. */
async function submitPassword(html: string, pageUrl: string, cookies: string[], password: string, opts: CrawlOptions) {
  const form = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi)].find((f) => PASSWORD_INPUT.test(f[0]));
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
  const action = new URL(formAttrs.action || pageUrl, pageUrl).href;
  const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  const headers: Record<string, string> = { Referer: pageUrl, ...(cookie ? { Cookie: cookie } : {}) };
  if ((formAttrs.method ?? "get").toLowerCase() === "post") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    return fetchPage(action, opts, { method: "POST", body: body.toString(), headers });
  }
  const target = new URL(action);
  target.search = body.toString();
  return fetchPage(target.href, opts, { headers });
}

async function runSources(url: string, html: string, opts: CrawlOptions): Promise<CrawlResult | null> {
  for (const source of sources) {
    const result = await source.crawl(url, html, opts);
    if (result?.links.length) return result;
  }
  return null;
}

/**
 * Fetches a container page and extracts its host links. Throws NeedsAttentionError
 * for captchas, challenges and password problems; an empty container is `{ links: [], source: "none" }`.
 */
export async function crawlContainer(url: string, opts: CrawlOptions): Promise<CrawlResult> {
  let page = await fetchPage(url, opts);

  if (opts.password && PASSWORD_INPUT.test(page.html)) {
    const submitted = await submitPassword(page.html, page.url, page.cookies, opts.password, opts);
    if (submitted) {
      if (PASSWORD_INPUT.test(submitted.html) || WRONG_PASSWORD.test(submitted.html)) {
        throw new NeedsAttentionError("Container rejected the password");
      }
      page = submitted;
    }
  }

  const result = await runSources(page.url, page.html, opts);
  if (result) return result;

  const attention = detectAttention(page.html, opts.password);
  if (attention) throw new NeedsAttentionError(attention);
  if (findCnl2Payloads(page.html).length) throw new Error("Found Click'n'Load data but couldn't decrypt it");
  if (DLC_LINK.test(page.html)) {
    throw new NeedsAttentionError("Container only offers a DLC file, which isn't supported — use Click'n'Load in a browser");
  }
  return { links: [], source: "none" };
}
