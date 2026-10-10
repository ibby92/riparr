"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ClipboardPaste, Loader, Search, TriangleAlert } from "lucide-react";
import { Tag } from "../../_kit";
import { hintFromPaste, searchTmdb } from "../tmdb-actions";
import { Segmented, TmdbPoster } from "./bits";
import type { ReleaseHint, TmdbHit } from "./types";

export type SearchKind = "show" | "movie" | "all";

const KINDS: { value: SearchKind; label: string }[] = [
  { value: "show", label: "Shows" },
  { value: "movie", label: "Movies" },
  { value: "all", label: "Both" },
];

const sameHit = (a: TmdbHit | null, b: TmdbHit) => !!a && a.tmdbId === b.tmdbId && a.type === b.type;

/**
 * TMDB search: type toggle, a debounced query box (Enter searches at once) and a list of
 * results to pick from. Titles already in the library link to their page instead.
 */
export function TmdbSearch({
  picked,
  onPick,
  onConfirm,
  initialQuery = "",
  initialKind = "show",
  excludeId,
  autoFocus,
  onHint,
}: {
  picked: TmdbHit | null;
  onPick: (hit: TmdbHit) => void;
  /** Double-click / Enter on a result: pick and move on. */
  onConfirm?: (hit: TmdbHit) => void;
  initialQuery?: string;
  initialKind?: SearchKind;
  /** The title being edited; its own match isn't "already in your library". */
  excludeId?: number;
  autoFocus?: boolean;
  /** Called with what a pasted container page/release name told us (e.g. the URL, for the first source). */
  onHint?: (hint: ReleaseHint) => void;
}) {
  const [kind, setKind] = useState<SearchKind>(initialKind);
  const [query, setQuery] = useState(initialQuery);
  const [year, setYear] = useState<number | undefined>(undefined);
  const [results, setResults] = useState<TmdbHit[] | null>(null);
  const [error, setError] = useState<{ text: string; needsKey?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const inputId = useId();
  const statusId = useId();

  async function run(q: string, k: SearchKind, y: number | undefined) {
    const mine = ++seq.current;
    if (!q.trim()) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await searchTmdb(q, k, y);
    if (mine !== seq.current) return; // a newer search started meanwhile
    setLoading(false);
    setResults(res.results);
    setError(res.error ? { text: res.error, needsKey: res.needsKey } : null);
  }

  // Debounced search as the user types or switches type.
  useEffect(() => {
    const t = setTimeout(() => void run(query, kind, year), query.trim().length < 2 ? 0 : 400);
    return () => clearTimeout(t);
     
  }, [query, kind, year]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex flex-wrap items-center gap-2">
        <Segmented name="tmdb_kind" label="Search for" value={kind} options={KINDS} onChange={setKind} />
        <PasteHelper
          onHint={(h) => {
            if (h.query) {
              setQuery(h.query);
              setYear(h.year);
            }
            onHint?.(h);
          }}
        />
      </div>

      <div role="search">
        <label htmlFor={inputId} className="sr-only">
          Search TMDB
        </label>
        <div className="relative">
          <Search size={16} strokeWidth={1.75} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            id={inputId}
            type="search"
            className="input pl-9"
            placeholder={kind === "movie" ? "Movie name, e.g. Harbor Lights" : "Show name, e.g. Doctor X"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setYear(undefined);
            }}
            onKeyDown={(e) => {
              // Enter searches now (no nested <form>: this panel also lives inside the Edit form).
              if (e.key === "Enter") {
                e.preventDefault();
                void run(query, kind, year);
              }
            }}
            autoComplete="off"
             
            autoFocus={autoFocus}
            aria-describedby={statusId}
          />
        </div>
      </div>

      <div id={statusId} role="status" aria-live="polite" className="flex min-h-5 items-center gap-1.5 text-xs text-muted">
        {loading ? (
          <>
            <Loader size={12} className="animate-spin" aria-hidden="true" /> Searching TMDB…
          </>
        ) : error ? null : results ? (
          results.length ? (
            `${results.length} result${results.length === 1 ? "" : "s"} from TMDB${year ? ` around ${year}` : ""}`
          ) : (
            "Nothing on TMDB matches that. Try another spelling or the original title."
          )
        ) : (
          "Type a name to search TMDB."
        )}
      </div>

      {error && (
        <div role="alert" className="flex gap-2 rounded-sm border border-border bg-critical-soft px-3 py-2 text-sm text-critical">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {error.text}{" "}
            {error.needsKey && (
              <Link href="/settings/connections" className="link">
                Open Connections
              </Link>
            )}
          </span>
        </div>
      )}

      {results && results.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="TMDB results">
          {results.map((r) => {
            const mine = r.inLibrary && r.inLibrary.id === excludeId;
            const taken = r.inLibrary && !mine;
            const selected = sameHit(picked, r);
            return (
              <li key={`${r.type}-${r.tmdbId}`}>
                <div
                  className={`grid grid-cols-[46px_minmax(0,1fr)] items-center gap-3 rounded-sm border p-2 text-left md:grid-cols-[46px_minmax(0,1fr)_auto] ${
                    selected ? "border-accent bg-accent-soft" : "border-border bg-surface"
                  } ${taken ? "" : "relative hover:border-border-strong"}`}
                >
                  <TmdbPoster src={r.posterUrl} seed={r.tmdbId} name={r.title} year={r.year} className="w-[46px]" />
                  <div className="min-w-0">
                    {taken ? (
                      <span className="block font-medium text-fg">{r.title}</span>
                    ) : (
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onPick(r)}
                        onDoubleClick={() => onConfirm?.(r)}
                        className="block text-left font-medium text-fg after:absolute after:inset-0 after:rounded-sm focus-visible:outline-none focus-visible:after:[outline:2px_solid_var(--focus)]"
                      >
                        {r.title}
                        {r.year ? <span className="font-normal text-muted"> ({r.year})</span> : null}
                      </button>
                    )}
                    {r.originalTitle && <span className="block truncate text-xs text-muted">{r.originalTitle}</span>}
                    {r.overview && <p className="mt-0.5 line-clamp-2 text-xs text-fg-2">{r.overview}</p>}
                    {taken && (
                      <p className="mt-1 text-xs text-muted">
                        Already in your library.{" "}
                        <Link href={`/titles/${r.inLibrary!.id}`} className="link">
                          Open {r.inLibrary!.name}
                        </Link>
                      </p>
                    )}
                    <span className="mt-1 inline-block md:hidden">
                      <Tag>{r.type === "show" ? "Show" : "Movie"}</Tag>
                    </span>
                  </div>
                  <span className="hidden md:block">
                    <Tag>{r.type === "show" ? "Show" : "Movie"}</Tag>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** "Paste a container page": reads a URL or release name locally and fills the search. */
function PasteHelper({ onHint }: { onHint: (hint: ReleaseHint) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  async function use() {
    setBusy(true);
    const hint = await hintFromPaste(text);
    setBusy(false);
    if (!hint.query && !hint.url) {
      setNote("Couldn't read a title from that. Type the name in the search box instead.");
      return;
    }
    setNote(
      hint.query
        ? `Searching for "${hint.query}"${hint.url ? ". The page will be added as the first source." : "."}`
        : "That link doesn't contain the title's name, so search for it below. The page will be added as the first source.",
    );
    onHint(hint);
  }

  return (
    <div className="ml-auto">
      <button type="button" className="btn btn-ghost min-h-8 px-2 text-[13px]" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <ClipboardPaste size={15} strokeWidth={1.75} aria-hidden="true" />
        Paste a container page
      </button>
      {open && (
        <div id={id} className="absolute inset-x-0 top-full z-20 mt-2 flex flex-col gap-2 rounded-sm border border-border bg-surface p-3 shadow-md md:left-auto md:w-[420px]">
          <label htmlFor={`${id}-text`} className="text-[13px] font-medium text-fg-2">
            Container URL or release name
          </label>
          <div className="flex gap-2">
            <input
              id={`${id}-text`}
              className="input input-mono"
              placeholder="https://mkvdrama.net/doctor-x-mafia-in-white"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void use();
                }
                if (e.key === "Escape") setOpen(false);
              }}
              autoComplete="off"
            />
            <button type="button" className="btn" disabled={!text.trim() || busy} onClick={() => void use()}>
              Use
            </button>
          </div>
          <p className="text-xs text-muted" role="status">
            {note ?? "Riparr reads the name from the link or file name. It doesn't open the page."}
          </p>
        </div>
      )}
    </div>
  );
}
