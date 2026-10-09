export type FileHash = { algo: "md5" | "sha1" | "sha256"; value: string };

export type OpenedStream = {
  body: ReadableStream<Uint8Array>;
  /** Byte offset the stream actually starts at: the requested offset, or 0 if the host ignored the Range. */
  offset: number;
};

/** One downloadable file behind a host link. A folder link resolves to many. */
export type RemoteFile = {
  /** Stable within its link across re-resolves (e.g. the host's file id), so restarts can match up partial downloads. */
  key: string;
  name: string;
  /** Sub-path inside a remote folder, using "/" separators, e.g. "Season 1". Empty for single files. */
  dir: string;
  size: number | null;
  hash: FileHash | null;
  /** Opens the file content starting at `offset` (for resume). */
  open(offset: number, signal: AbortSignal): Promise<OpenedStream>;
};

export type HostAccount = Record<string, string>;

export type ResolveOptions = {
  account: HostAccount | null;
  /** Archive or folder password from the container, if any. */
  password: string | null;
  signal: AbortSignal;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
};

/**
 * Turns a host link into the files behind it.
 *
 * Throws HostOfflineError when the content is gone, RateLimitError when
 * throttled, and NeedsAttentionError when an account or password is required.
 */
export interface HostResolver {
  /** Short id used for settings and per-host concurrency, e.g. "pixeldrain". */
  id: string;
  /** Returns true for links this resolver handles. */
  matches(url: URL): boolean;
  resolve(url: URL, opts: ResolveOptions): Promise<RemoteFile[]>;
}
