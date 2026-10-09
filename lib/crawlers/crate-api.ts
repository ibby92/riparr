import { createDecipheriv } from "node:crypto";

/**
 * Container pages that render their link list with JavaScript (mkvdrama.net and
 * sites on the same engine): the HTML carries an XOR-obfuscated API token and
 * AES-GCM key/IV; the API returns the encrypted list. We do what the page's own
 * script does, without a browser.
 *
 *   <div id="w" data-s="<container id>" data-p="c">
 *   <div id="xd" data-n="[[..],[..]]" data-k="[[..],[..]]" data-v="[[..],[..]]">
 *   GET /<p>/<s>/p/<n>  ->  { d: base64(AES-GCM ciphertext + tag) }  ->  { title, links: [...] }
 */

export type CrateLoader = { apiPath: string; key: Buffer; iv: Buffer };

export type CrateLink = {
  url: string;
  host?: string;
  label?: string;
  episode?: string;
  quality?: string;
  size?: string;
};

export type CrateList = { title: string; links: CrateLink[] };

function decodeEntities(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, "&");
}

/** `[[a…],[b…]]` -> bytes a[i] ^ b[i]. */
function xorPair(raw: string): Buffer | null {
  try {
    const [a, b] = JSON.parse(decodeEntities(raw)) as [number[], number[]];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return null;
    return Buffer.from(a.map((v, i) => (v ^ b[i]) & 0xff));
  } catch {
    return null;
  }
}

function openingTag(html: string, id: string): string | null {
  return new RegExp(`<[a-z]+\\b[^>]*\\bid=["']${id}["'][^>]*>`, "is").exec(html)?.[0] ?? null;
}

function dataAttr(tag: string, name: string): string | null {
  return new RegExp(`\\bdata-${name}=(["'])([\\s\\S]*?)\\1`, "i").exec(tag)?.[2] ?? null;
}

/** Finds the loader parameters on a page, or null if the page isn't this engine. */
export function parseCrateLoader(html: string): CrateLoader | null {
  const w = openingTag(html, "w");
  const xd = openingTag(html, "xd");
  if (!w || !xd) return null;
  const s = dataAttr(w, "s");
  const p = dataAttr(w, "p");
  const n = dataAttr(xd, "n");
  const k = dataAttr(xd, "k");
  const v = dataAttr(xd, "v");
  if (!s || !p || !n || !k || !v) return null;

  const token = xorPair(n)?.toString("latin1");
  const key = xorPair(k);
  const iv = xorPair(v);
  if (!token || !key || !iv || ![16, 24, 32].includes(key.length) || iv.length < 12) return null;
  // Only path-safe pieces end up in the URL.
  if (![s, p, token].every((part) => /^[\w.-]+$/.test(part))) return null;
  return { apiPath: `/${p}/${s}/p/${token}`, key, iv };
}

/** Decrypts the API's `d` field (AES-GCM, 16-byte tag appended) into the link list. */
export function decryptCrateList(d: string, key: Buffer, iv: Buffer): CrateList {
  const buf = Buffer.from(d, "base64");
  if (buf.length <= 16) throw new Error("Container list is empty or corrupted");
  const decipher = createDecipheriv(`aes-${key.length * 8}-gcm` as "aes-128-gcm", key, iv);
  decipher.setAuthTag(buf.subarray(-16));
  const json = JSON.parse(Buffer.concat([decipher.update(buf.subarray(0, -16)), decipher.final()]).toString("utf8"));

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const links: CrateLink[] = [];
  for (const l of Array.isArray(json?.links) ? json.links : []) {
    const url = str(l?.url);
    if (!url || !/^https?:\/\/\S+$/i.test(url)) continue;
    links.push({ url, host: str(l.host), label: str(l.label), episode: str(l.episode), quality: str(l.quality), size: str(l.size) });
  }
  return { title: str(json?.title) ?? "", links };
}
