import { HostOfflineError, NeedsAttentionError, RateLimitError } from "@/lib/errors";
import { type ErrorMapper, fetchJson, httpOpener, readJsonSafe } from "./http";
import type { HostResolver, RemoteFile, ResolveOptions } from "./types";

const API = "https://pixeldrain.com/api";
const HOSTS = new Set(["pixeldrain.com", "pixeldrain.net", "pixeldra.in", "pixeldrain.dev"]);
const HOUR = 3_600_000;

type FileInfo = {
  id: string;
  name: string;
  size: number;
  hash_sha256?: string;
  availability?: string;
  availability_message?: string;
};

type ListInfo = {
  id: string;
  title: string;
  files: { id: string; name: string; size: number }[];
};

type PixeldrainLink = { kind: "file" | "list"; id: string };

/** Parses /u/<id>, /l/<id>, /api/file/<id>[/info] and /api/list/<id> on any pixeldrain domain. */
export function parsePixeldrainUrl(url: URL): PixeldrainLink | null {
  if (!HOSTS.has(url.hostname.toLowerCase().replace(/^www\./, ""))) return null;
  const m = url.pathname.match(/^\/(?:(u|l)|api\/(file|list))\/([A-Za-z0-9]+)(?:\/info)?\/?$/);
  if (!m) return null;
  const kind = m[1] === "l" || m[2] === "list" ? "list" : "file";
  return { kind, id: m[3] };
}

/** Canonical https://pixeldrain.com/u|l/<id> form. */
export function canonicalPixeldrainUrl(url: URL): string | null {
  const link = parsePixeldrainUrl(url);
  return link && `https://pixeldrain.com/${link.kind === "list" ? "l" : "u"}/${link.id}`;
}

/** Maps a pixeldrain error code (`value` in error JSON, or `availability`) to a typed error. */
export function pixeldrainError(code: string, message: string | undefined, status?: number): Error {
  const msg = `pixeldrain: ${message || code}`;
  switch (code) {
    case "not_found":
    case "unavailable_for_legal_reasons":
      return new HostOfflineError(msg);
    case "max_concurrent_downloads":
      return new RateLimitError(msg, 60_000);
    case "server_overload_captcha_required":
      return new RateLimitError(msg, 10 * 60_000);
    case "ip_download_limited_captcha_required":
    case "transfer_limit_exceeded":
    case "download_limit_exceeded":
      return new RateLimitError(msg, HOUR);
    case "file_rate_limited_captcha_required":
    case "virus_detected_captcha_required":
    case "hotlink_detected":
    case "unauthorized":
    case "forbidden":
      return new NeedsAttentionError(`${msg} (captcha or premium API key needed)`);
  }
  if (status === 404 || status === 451) return new HostOfflineError(msg);
  if (code.endsWith("_captcha_required")) return new NeedsAttentionError(msg);
  return new Error(msg);
}

const mapError: ErrorMapper = async (res) => {
  const body = (await readJsonSafe(res)) as { value?: string; message?: string } | null;
  if (body?.value) return pixeldrainError(body.value, body.message, res.status);
  if (res.status === 451) return new HostOfflineError("pixeldrain: removed for legal reasons");
  return null;
};

function authHeaders(opts: ResolveOptions): Record<string, string> {
  const key = opts.account?.apiKey;
  return key ? { authorization: `Basic ${Buffer.from(`:${key}`).toString("base64")}` } : {};
}

export const pixeldrain: HostResolver = {
  id: "pixeldrain",
  matches: (url) => parsePixeldrainUrl(url) !== null,
  async resolve(url, opts) {
    const link = parsePixeldrainUrl(url);
    if (!link) throw new Error(`Not a pixeldrain link: ${url}`);
    const headers = authHeaders(opts);
    const http = { headers, fetch: opts.fetch, mapError, signal: opts.signal };

    const toFile = (f: { id: string; name: string; size: number; hash_sha256?: string }): RemoteFile => ({
      key: f.id,
      name: f.name,
      dir: "",
      size: typeof f.size === "number" ? f.size : null,
      hash: f.hash_sha256 ? { algo: "sha256", value: f.hash_sha256 } : null,
      open: httpOpener(`${API}/file/${encodeURIComponent(f.id)}?download`, { headers, fetch: opts.fetch, mapError }),
    });

    if (link.kind === "file") {
      const info = await fetchJson<FileInfo>(`${API}/file/${link.id}/info`, http);
      if (info.availability) throw pixeldrainError(info.availability, info.availability_message);
      return [toFile(info)];
    }
    const list = await fetchJson<ListInfo>(`${API}/list/${link.id}`, http);
    return (list.files ?? []).map(toFile);
  },
};
