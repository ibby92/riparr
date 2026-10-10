"use client";

import { useEffect, useState } from "react";
import { ArrowUp, Check, Folder, Loader, X } from "lucide-react";

type Listing = { path: string; parent: string | null; dirs: { name: string; path: string }[] };

async function fetchListing(path: string): Promise<Listing> {
  const res = await fetch(`/api/v1/filesystem?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  const body = (await res.json()) as Listing | { error: string };
  if (!res.ok || "error" in body) throw new Error("error" in body ? body.error : `HTTP ${res.status}`);
  return body;
}

/**
 * Inline folder picker over GET /api/v1/filesystem (the session cookie authenticates it).
 * Starts at `start` (or "/"), navigates into folders, and hands the chosen path to `onPick`.
 */
export function FolderBrowser({ start, onPick, onClose }: { start: string; onPick: (path: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // First listing: the typed path if it exists, otherwise the filesystem root.
  useEffect(() => {
    let stop = false;
    const first = start.startsWith("/") ? start : "/";
    fetchListing(first)
      .catch(() => fetchListing("/"))
      .then(
        (l) => !stop && setListing(l),
        (err: unknown) => !stop && setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => !stop && setLoading(false));
    return () => {
      stop = true;
    };
  }, [start]);

  async function load(path: string) {
    setLoading(true);
    setError(null);
    try {
      setListing(await fetchListing(path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-sm border border-border bg-surface-2">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          className="btn btn-ghost min-h-[32px] px-2"
          aria-label="Up one folder"
          disabled={!listing?.parent || loading}
          onClick={() => listing?.parent && void load(listing.parent)}
        >
          <ArrowUp size={15} aria-hidden="true" />
        </button>
        <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg">{listing?.path ?? start}</code>
        {loading && <Loader size={15} className="animate-spin text-muted" aria-label="Loading" />}
        <button type="button" className="btn btn-ghost min-h-[32px] px-2" aria-label="Close folder browser" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      {error && <p className="px-3 py-2 text-xs text-critical">{error}</p>}
      <ul className="max-h-64 overflow-y-auto py-1" aria-label="Folders">
        {listing?.dirs.length === 0 && <li className="px-3 py-2 text-sm text-muted">No folders inside this one.</li>}
        {listing?.dirs.map((d) => (
          <li key={d.path}>
            <button
              type="button"
              className="flex min-h-[38px] w-full items-center gap-2 px-3 text-left text-sm text-fg hover:bg-surface-3"
              onClick={() => void load(d.path)}
            >
              <Folder size={16} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden="true" />
              <span className="min-w-0 truncate font-mono text-[13px]">{d.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
        <button type="button" className="btn btn-primary" disabled={!listing || loading} onClick={() => listing && onPick(listing.path)}>
          <Check size={15} aria-hidden="true" />
          Use this folder
        </button>
      </div>
    </div>
  );
}
