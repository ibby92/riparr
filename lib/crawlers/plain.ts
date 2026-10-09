import { decodeEntities } from "./html";
import { isKnownHostUrl } from "./known-hosts";
import type { ContainerSource } from "./types";

// An href attribute, or a bare http(s) URL anywhere in the markup/text, in page order.
const TOKEN = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))|https?:\/\/[^\s"'<>`\\]+/gi;

function cleanUrl(raw: string, base: string): string | null {
  let s = decodeEntities(raw).trim();
  s = s.split(/[\s<>"]/)[0];
  // Trailing punctuation from prose ("see https://x/y."), and closers without an opener.
  for (;;) {
    const trimmed = s.replace(/[.,;:!?'*]+$/, "");
    const last = trimmed.at(-1);
    const pair = last === ")" ? "(" : last === "]" ? "[" : last === "}" ? "{" : null;
    if (pair && !trimmed.includes(pair)) s = trimmed.slice(0, -1);
    else if (trimmed !== s) s = trimmed;
    else break;
  }
  try {
    return new URL(s, base).href;
  } catch {
    return null;
  }
}

/** Known-host URLs in anchors and plain text, deduplicated, in page order. */
export function extractHostLinks(html: string, baseUrl: string): string[] {
  // JSON-embedded URLs often come escaped as https:\/\/…
  const source = html.replace(/\\\//g, "/");
  const seen = new Set<string>();
  for (const m of source.matchAll(TOKEN)) {
    const url = cleanUrl(m[1] ?? m[2] ?? m[3] ?? m[0], baseUrl);
    if (url && isKnownHostUrl(url)) seen.add(url);
  }
  return [...seen];
}

export const plainSource: ContainerSource = {
  name: "plain",
  async crawl(url, html) {
    const links = extractHostLinks(html, url);
    return links.length ? { links, source: "plain" } : null;
  },
};
