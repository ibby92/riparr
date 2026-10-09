import { canonicalPixeldrainUrl, pixeldrain } from "./pixeldrain";
import { gofile, parseGofileUrl } from "./gofile";
import { canonicalMegaUrl, mega } from "./mega";
import type { HostResolver } from "./types";

export type { HostResolver, RemoteFile, ResolveOptions, OpenedStream, FileHash, HostAccount } from "./types";

export const RESOLVERS: HostResolver[] = [pixeldrain, gofile, mega];

function toUrl(url: string | URL): URL | null {
  if (url instanceof URL) return url;
  try {
    return new URL(url.trim());
  } catch {
    return null;
  }
}

/** The resolver that handles `url`, or null if the host is unsupported. */
export function findResolver(url: string | URL): HostResolver | null {
  const u = toUrl(url);
  return (u && RESOLVERS.find((r) => r.matches(u))) || null;
}

/** Resolver id for supported links, else the bare hostname (no `www.`). */
export function hostIdFor(url: string): string {
  const u = toUrl(url);
  if (!u) return "unknown";
  return findResolver(u)?.id ?? u.hostname.toLowerCase().replace(/^www\./, "");
}

const TRACKING = /^(utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|yclid|_ga|_gl|ref|ref_src|si)$/i;

/**
 * Canonicalises a link for dedupe: lowercase host without `www.`, alias domains
 * mapped to one, tracking params dropped, fragment dropped except MEGA's key.
 */
export function normalizeLinkUrl(url: string): string {
  const u = toUrl(url);
  if (!u || !/^https?:$/.test(u.protocol)) return url.trim();
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");

  const known = canonicalPixeldrainUrl(u) ?? canonicalMegaUrl(u);
  if (known) return known;
  const code = parseGofileUrl(u);
  if (code) return `https://gofile.io/d/${code}`;

  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.hash = "";
  return u.toString();
}
