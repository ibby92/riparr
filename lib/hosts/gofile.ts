import { createHash } from "node:crypto";
import { HostOfflineError, NeedsAttentionError, RateLimitError } from "@/lib/errors";
import { DEFAULT_RETRY_MS, type ErrorMapper, fetchJson, httpOpener, parseRetryAfter, readJsonSafe, USER_AGENT } from "./http";
import type { HostResolver, RemoteFile, ResolveOptions } from "./types";

/*
 * Flow (checked 2026-10 against gofile.io and its wt.obf.js):
 *   POST https://api.gofile.io/accounts                 -> data.token (guest)
 *   GET  https://api.gofile.io/contents/<id>?...&password=<sha256>
 *        Authorization: Bearer <token>, X-Website-Token: <wt>, X-BL: en-US
 *   GET  <child.link> with Cookie: accountToken=<token>
 * wt = sha256(`${UA}::${lang}::${token}::${floor(now/14400s)}::${salt}`). The salt
 * rotates every few months; override it with the account setting `wtSalt`.
 */

const API = "https://api.gofile.io";
const LANG = "en-US";
export const GOFILE_WT_SALT = "12af056dacea0b";
export const GOFILE_WT_SCRIPT_URL = "https://gofile.io/js/wt.obf.js";

/** gofile still rejects the website token on a fresh guest: the salt (or scheme) is probably outdated. */
export class StaleSaltError extends NeedsAttentionError {
  name = "StaleSaltError";
}

type Child = {
  id: string;
  type: "file" | "folder";
  name: string;
  size?: number;
  md5?: string;
  link?: string;
};

type Content = Child & {
  canAccess?: boolean;
  password?: boolean;
  passwordStatus?: string;
  children?: Record<string, Child>;
};

type ApiResponse<T> = { status: string; data: T; metadata?: { hasNextPage?: boolean } };

/** Error-status from the gofile API, e.g. "error-notFound". */
class GofileStatus extends Error {
  constructor(
    readonly status: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`gofile: ${status}`);
  }
}

/** Parses gofile.io/d/<code>. */
export function parseGofileUrl(url: URL): string | null {
  if (url.hostname.toLowerCase().replace(/^www\./, "") !== "gofile.io") return null;
  return url.pathname.match(/^\/d\/([A-Za-z0-9-]+)\/?$/)?.[1] ?? null;
}

export function websiteToken(token: string, salt = GOFILE_WT_SALT, now = Date.now()): string {
  const slot = Math.floor(now / 1000 / 14400);
  return createHash("sha256").update(`${USER_AGENT}::${LANG}::${token}::${slot}::${salt}`).digest("hex");
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const mapError: ErrorMapper = async (res) => {
  const body = (await readJsonSafe(res)) as { status?: string } | null;
  const retry = parseRetryAfter(res.headers.get("retry-after"));
  return body?.status ? new GofileStatus(body.status, retry) : null;
};

let guestToken: Promise<string> | null = null;

/** Drops the cached guest token (tests). */
export function resetGofileGuest() {
  guestToken = null;
}

async function createGuest(opts: ResolveOptions): Promise<string> {
  const res = await fetchJson<ApiResponse<{ token: string }>>(`${API}/accounts`, {
    method: "POST",
    headers: { origin: "https://gofile.io", referer: "https://gofile.io/" },
    fetch: opts.fetch,
    mapError,
    signal: opts.signal,
  });
  if (res.status !== "ok" || !res.data?.token) throw new GofileStatus(res.status);
  return res.data.token;
}

function getGuest(opts: ResolveOptions, fresh: boolean): Promise<string> {
  if (fresh || !guestToken) {
    const p = createGuest(opts);
    guestToken = p;
    p.catch(() => {
      if (guestToken === p) guestToken = null;
    });
  }
  return guestToken;
}

function toTypedError(e: unknown): unknown {
  if (!(e instanceof GofileStatus)) return e;
  switch (e.status) {
    case "error-notFound":
      return new HostOfflineError("gofile: content not found or deleted");
    case "error-rateLimit":
      return new RateLimitError("gofile: rate limited", e.retryAfterMs ?? DEFAULT_RETRY_MS);
    case "error-passwordRequired":
      return new NeedsAttentionError("gofile: folder password required");
    case "error-passwordWrong":
      return new NeedsAttentionError("gofile: wrong folder password");
    case "error-notPublic":
      return new NeedsAttentionError("gofile: folder is private");
    case "error-notPremium":
      return new StaleSaltError("gofile: API rejected the request (website-token salt may be outdated; refresh it in Settings → Hosts)");
    case "error-auth":
    case "error-token":
    case "error-wrongToken":
      return new NeedsAttentionError("gofile: account token rejected");
  }
  return new Error(e.message);
}

/** Statuses after which a fresh guest token is worth one retry. */
const isAuthStatus = (e: unknown) =>
  e instanceof GofileStatus && ["error-auth", "error-token", "error-wrongToken", "error-notPremium"].includes(e.status);

export const gofile: HostResolver = {
  id: "gofile",
  matches: (url) => parseGofileUrl(url) !== null,
  async resolve(url, opts) {
    const code = parseGofileUrl(url);
    if (!code) throw new Error(`Not a gofile link: ${url}`);
    const premium = opts.account?.token || null;
    const salt = opts.account?.wtSalt || GOFILE_WT_SALT;
    const password = opts.password ? sha256(opts.password) : null;

    let token: string = premium ?? (await getGuest(opts, false).catch((e) => Promise.reject(toTypedError(e))));
    try {
      return await walk(code, token, salt, password, opts);
    } catch (e) {
      if (premium || !isAuthStatus(e)) throw toTypedError(e);
    }
    token = await getGuest(opts, true).catch((e) => Promise.reject(toTypedError(e)));
    try {
      return await walk(code, token, salt, password, opts);
    } catch (e) {
      throw toTypedError(e);
    }
  },
};

async function getContent(id: string, token: string, salt: string, password: string | null, opts: ResolveOptions) {
  let content: Content | null = null;
  const children: Record<string, Child> = {};
  for (let page = 1; ; page++) {
    const q = new URLSearchParams({ page: String(page), pageSize: "1000", sortField: "name", sortDirection: "1" });
    if (password) q.set("password", password);
    const res = await fetchJson<ApiResponse<Content>>(`${API}/contents/${encodeURIComponent(id)}?${q}`, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-website-token": websiteToken(token, salt),
        "x-bl": LANG,
        origin: "https://gofile.io",
        referer: "https://gofile.io/",
      },
      fetch: opts.fetch,
      mapError,
      signal: opts.signal,
    });
    if (res.status !== "ok") throw new GofileStatus(res.status);
    content ??= res.data;
    Object.assign(children, res.data.children ?? {});
    if (!res.metadata?.hasNextPage || page >= 50) break;
  }
  const c = content!;
  if (c.password && c.passwordStatus !== "passwordOk") {
    throw new GofileStatus(c.passwordStatus === "passwordWrong" ? "error-passwordWrong" : "error-passwordRequired");
  }
  if (c.canAccess === false) throw new GofileStatus("error-notPublic");
  return { ...c, children };
}

async function walk(code: string, token: string, salt: string, password: string | null, opts: ResolveOptions) {
  const files: RemoteFile[] = [];
  const headers = { cookie: `accountToken=${token}`, referer: "https://gofile.io/" };
  const fileOf = (c: Child, dir: string): RemoteFile => ({
    key: c.id,
    name: c.name,
    dir,
    size: typeof c.size === "number" ? c.size : null,
    hash: c.md5 ? { algo: "md5", value: c.md5 } : null,
    open: httpOpener(c.link!, { headers, fetch: opts.fetch }),
  });

  const seen = new Set<string>();
  const visit = async (id: string, dir: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const content = await getContent(id, token, salt, password, opts);
    if (content.type === "file") {
      if (content.link) files.push(fileOf(content, dir));
      return;
    }
    for (const child of Object.values(content.children)) {
      if (child.type === "file" && child.link) files.push(fileOf(child, dir));
      else if (child.type === "folder") {
        const name = child.name.replaceAll("/", "_");
        await visit(child.id, dir ? `${dir}/${name}` : name);
      }
    }
  };
  await visit(code, "");
  return files;
}
