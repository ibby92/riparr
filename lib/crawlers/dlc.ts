import { createDecipheriv } from "node:crypto";

/**
 * DLC containers (JDownloader's encrypted link files), decrypted the same way
 * pyLoad does: the last 88 chars are a key that JDownloader's service turns
 * into an `<rc>` value; that, decrypted with a fixed app key, is the AES
 * key+IV for the rest. Requires reaching service.jdownloader.org.
 */
const SERVICE = "http://service.jdownloader.org/dlcrypt/service.php";
const APP_KEY = Buffer.from("cb99b5cbc24db398");
const APP_IV = Buffer.from("9bc24cb995cb8db3");
const TIMEOUT_MS = 30_000;
const MAX_DLC_BYTES = 2 * 1024 * 1024;

export type DlcFile = { url: string; name?: string; size?: string };
export type DlcPackage = { name: string; links: string[]; files: DlcFile[] };

export class DlcError extends Error {
  name = "DlcError";
}

function aesCbc(key: Buffer, iv: Buffer, data: Buffer) {
  const decipher = createDecipheriv("aes-128-cbc", key, iv).setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** Base64 that may carry trailing NUL/padding garbage after raw AES decryption. */
function b64(text: string) {
  return Buffer.from(text.replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
}

/** Splits a DLC file into the service key (last 88 chars) and the encrypted payload. */
export function splitDlc(content: string): { key: string; payload: Buffer } {
  let data = content.replace(/\s+/g, "");
  data += "=".repeat((4 - (data.length % 4)) % 4);
  if (data.length <= 88 || !/^[A-Za-z0-9+/=_-]+$/.test(data)) throw new DlcError("Not a DLC file");
  return { key: data.slice(-88), payload: Buffer.from(data.slice(0, -88), "base64") };
}

/** Decrypts the payload given the service's `<rc>` value. Pure, for tests. */
export function decryptDlcPayload(payload: Buffer, rc: string): DlcPackage[] {
  const rcBytes = b64(rc).subarray(0, 16);
  if (rcBytes.length !== 16) throw new DlcError("DLC service returned an invalid key");
  const key = aesCbc(APP_KEY, APP_IV, rcBytes);
  if (payload.length === 0 || payload.length % 16 !== 0) throw new DlcError("DLC payload is corrupted");
  const xml = b64(aesCbc(key, key, payload).toString("latin1")).toString("utf8");
  return parseDlcXml(xml);
}

/**
 * Extracts packages and their URLs. Deliberately regex-based rather than a full
 * XML parser: DLC XML is simple and this can't be tricked into entity expansion.
 */
export function parseDlcXml(xml: string): DlcPackage[] {
  const content = /<content>([\s\S]*?)<\/content>/i.exec(xml)?.[1];
  if (content === undefined) throw new DlcError("DLC content is unreadable");
  const packages: DlcPackage[] = [];
  for (const pkg of content.matchAll(/<package\b([^>]*)>([\s\S]*?)<\/package>/gi)) {
    const nameAttr = /\bname\s*=\s*"([^"]*)"/i.exec(pkg[1])?.[1] ?? "";
    const files: DlcFile[] = [];
    for (const file of pkg[2].matchAll(/<file\b[^>]*>([\s\S]*?)<\/file>/gi)) {
      const field = (tag: string) => {
        const raw = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, "i").exec(file[1])?.[1];
        return raw ? b64(raw).toString("utf8").trim() || undefined : undefined;
      };
      const url = field("url");
      if (!url || !/^https?:\/\/\S+$/i.test(url)) continue;
      files.push({ url, name: field("filename"), size: field("size") });
    }
    packages.push({ name: b64(nameAttr).toString("utf8").trim(), links: files.map((f) => f.url), files });
  }
  return packages;
}

/** Decrypts a DLC file's text into packages of links (one network call to JDownloader's service). */
export async function decryptDlc(
  content: string,
  opts: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<DlcPackage[]> {
  if (content.length > MAX_DLC_BYTES) throw new DlcError("DLC file is too large");
  const { key, payload } = splitDlc(content);
  const url = `${SERVICE}?srcType=dlc&destType=pylo&data=${encodeURIComponent(key)}`;
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);

  let body: string;
  try {
    const res = await (opts.fetch ?? fetch)(url, { signal });
    body = await res.text();
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new DlcError(`JDownloader's DLC service is unreachable (${err instanceof Error ? err.message : err})`);
  }
  const rc = /<rc>([\s\S]+?)<\/rc>/.exec(body)?.[1];
  if (!rc) throw new DlcError("JDownloader's DLC service rejected this container (expired or corrupted)");
  return decryptDlcPayload(payload, rc);
}

/** All links across packages, deduplicated in order. */
export function dlcLinks(packages: DlcPackage[]): string[] {
  return [...new Set(packages.flatMap((p) => p.links))];
}

/**
 * Splits a release file name like "Show.S01E02.NF.x264.1080p.mkv 665.21 MB" into
 * label, episode, quality and size (as containers often append the size).
 */
export function metaFromFileName(raw: string | undefined): { label?: string; episode?: string; quality?: string; size?: string } {
  if (!raw) return {};
  const sizeMatch = /\s+(\d+(?:\.\d+)?\s*(?:[KMGT]i?B))\s*$/i.exec(raw);
  const label = (sizeMatch ? raw.slice(0, sizeMatch.index) : raw).trim() || undefined;
  return {
    label,
    episode: /\b(S\d{1,3}E\d{1,4})\b/i.exec(raw)?.[1]?.toUpperCase(),
    quality: /\b(\d{3,4}p|4k|2160p)\b/i.exec(raw)?.[1]?.toLowerCase(),
    size: sizeMatch?.[1],
  };
}
