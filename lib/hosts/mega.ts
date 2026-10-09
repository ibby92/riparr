import { Readable } from "node:stream";
// Type-only at module level: the web app imports this file for URL parsing and must never load megajs.
import type { File as MegaFile } from "megajs";
import { HostOfflineError, NeedsAttentionError, RateLimitError } from "@/lib/errors";
import type { HostResolver, OpenedStream, RemoteFile } from "./types";

const HOSTS = new Set(["mega.nz", "mega.co.nz"]);
const HOUR = 3_600_000;

export type MegaLink = {
  kind: "file" | "folder";
  id: string;
  /** Decryption key from the fragment; null when the link was posted without it. */
  key: string | null;
  /** Node handle inside a folder link (`/folder/x#k/file/y`, `#F!x!k!y`). */
  sub: string | null;
  subKind: "file" | "folder" | null;
};

/** Parses modern (/file/, /folder/, /embed/) and legacy (#!, #F!) MEGA links. */
export function parseMegaUrl(url: URL): MegaLink | null {
  if (!HOSTS.has(url.hostname.toLowerCase().replace(/^www\./, ""))) return null;
  const hash = url.hash.replace(/^#/, "");

  const modern = url.pathname.match(/^\/(file|folder|embed)\/([A-Za-z0-9_-]+)\/?$/);
  if (modern) {
    const [key, subKind, sub] = hash.split("/");
    const hasSub = modern[1] === "folder" && !!sub && (subKind === "file" || subKind === "folder");
    return {
      kind: modern[1] === "folder" ? "folder" : "file",
      id: modern[2],
      key: key || null,
      sub: hasSub ? sub : null,
      subKind: hasSub ? (subKind as "file" | "folder") : null,
    };
  }

  const legacy = hash.match(/^(F?)!([A-Za-z0-9_-]+)(?:!([A-Za-z0-9_-]*))?(?:!([A-Za-z0-9_-]+))?/);
  if (legacy && (url.pathname === "/" || url.pathname === "" || url.pathname === "/embed")) {
    const folder = legacy[1] === "F";
    const sub = folder ? (legacy[4] ?? null) : null;
    return { kind: folder ? "folder" : "file", id: legacy[2], key: legacy[3] || null, sub, subKind: sub ? "file" : null };
  }
  return null;
}

/** Canonical https://mega.nz/file|folder/<id>#<key>[/file/<sub>] form. */
export function canonicalMegaUrl(url: URL): string | null {
  const l = parseMegaUrl(url);
  if (!l) return null;
  const frag = l.key ? `#${l.key}${l.sub ? `/${l.subKind}/${l.sub}` : ""}` : "";
  return `https://mega.nz/${l.kind}/${l.id}${frag}`;
}

/** Maps megajs errors (API codes like "ENOENT (-9)", bandwidth limits) to typed errors. */
export function mapMegaError(e: unknown): Error {
  const err = e instanceof Error ? e : new Error(String(e));
  const msg = err.message;
  if (err instanceof HostOfflineError || err instanceof RateLimitError || err instanceof NeedsAttentionError) return err;
  const timeLeft = Number((err as { timeLimit?: unknown }).timeLimit);
  if (/bandwidth limit/i.test(msg)) {
    return new RateLimitError(`mega: ${msg}`, Number.isFinite(timeLeft) && timeLeft > 0 ? timeLeft * 1000 : HOUR);
  }
  if (/^E(NOENT|BLOCKED) /.test(msg) || /not found in folder/i.test(msg)) return new HostOfflineError(`mega: ${msg}`);
  if (/^E(OVERQUOTA|GOINGOVERQUOTA|SHAREROVERQUOTA) /.test(msg) || /509/.test(msg)) {
    return new RateLimitError(`mega: ${msg}`, HOUR);
  }
  if (/^E(AGAIN|RATELIMIT|TEMPUNAVAIL|TOOMANYCONNECTIONS) /.test(msg) || /rate limit/i.test(msg)) {
    return new RateLimitError(`mega: ${msg}`, 5 * 60_000);
  }
  if (/could not be decrypted|EKEY |key isn't defined/i.test(msg)) return new NeedsAttentionError(`mega: bad decryption key (${msg})`);
  if (/^E(ACCESS|PAYWALL|MFAREQUIRED) /.test(msg)) return new NeedsAttentionError(`mega: ${msg}`);
  return err;
}

/** Wraps a megajs download stream: waits for the first chunk so setup errors surface from open(). */
async function toWebStream(node: Readable, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const onAbort = () => node.destroy(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  const reader = (Readable.toWeb(node) as ReadableStream<Uint8Array>).getReader();
  const read = async () => {
    try {
      return await reader.read();
    } catch (e) {
      signal.removeEventListener("abort", onAbort);
      throw signal.aborted ? e : mapMegaError(e);
    }
  };
  const first = await read();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.done) {
        signal.removeEventListener("abort", onAbort);
        controller.close();
      } else controller.enqueue(first.value);
    },
    async pull(controller) {
      const next = await read();
      if (next.done) {
        signal.removeEventListener("abort", onAbort);
        controller.close();
      } else controller.enqueue(next.value);
    },
    cancel(reason) {
      signal.removeEventListener("abort", onAbort);
      return reader.cancel(reason);
    },
  });
}

function remoteFile(file: MegaFile, key: string, dir: string): RemoteFile {
  return {
    key,
    name: file.name ?? key,
    dir,
    size: typeof file.size === "number" ? file.size : null,
    hash: null,
    async open(offset, signal): Promise<OpenedStream> {
      if (file.size !== undefined && offset >= file.size && offset > 0) {
        return { body: new ReadableStream({ start: (c) => c.close() }), offset };
      }
      let node: Readable;
      try {
        node = file.download({ start: offset }) as unknown as Readable;
      } catch (e) {
        throw mapMegaError(e);
      }
      return { body: await toWebStream(node, signal), offset };
    },
  };
}

const safeName = (s: string | null | undefined, fallback: string) => (s ?? fallback).replaceAll("/", "_");

function nodeHandle(f: MegaFile): string {
  if (f.nodeId) return f.nodeId;
  return Array.isArray(f.downloadId) ? String(f.downloadId[1]) : String(f.downloadId);
}

export const mega: HostResolver = {
  id: "mega",
  matches: (url) => parseMegaUrl(url) !== null,
  async resolve(url) {
    const link = parseMegaUrl(url);
    if (!link) throw new Error(`Not a MEGA link: ${url}`);
    if (!link.key) throw new NeedsAttentionError("mega: link has no decryption key");
    let root: MegaFile;
    try {
      // turbopackIgnore keeps megajs out of the Next build; the worker's esbuild bundle includes it.
      const { File } = await import(/* turbopackIgnore: true */ "megajs");
      const file = new File({
        downloadId: link.id,
        key: link.key,
        directory: link.kind === "folder",
        loadedFile: link.sub ?? undefined,
      });
      root = (await file.loadAttributes()) as MegaFile;
    } catch (e) {
      throw mapMegaError(e);
    }

    if (!root.directory) return [remoteFile(root, link.kind === "file" ? link.id : nodeHandle(root), "")];
    const out: RemoteFile[] = [];
    const walk = (folder: MegaFile, dir: string) => {
      for (const child of folder.children ?? []) {
        const name = safeName(child.name, nodeHandle(child));
        if (child.directory) walk(child, dir ? `${dir}/${name}` : name);
        else out.push(remoteFile(child, nodeHandle(child), dir));
      }
    };
    walk(root, "");
    return out;
  },
};
