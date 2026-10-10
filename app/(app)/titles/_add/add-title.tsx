"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, FolderPlus, Info, Plus, TriangleAlert, X } from "lucide-react";
import { Tag } from "../../_kit";
import { addTitle } from "../actions";
import { tmdbDetails } from "../tmdb-actions";
import { Errors, Segmented, TmdbPoster } from "./bits";
import type { MediaKind } from "./path-preview";
import { newSourceRow, SourcesFields, type SourceRow } from "./sources-fields";
import { syncOptions, TitleOptions, type Options } from "./title-options";
import { TmdbSearch } from "./tmdb-search";
import type { FormDefaults, FormState, RootOption, TmdbHit } from "./types";

type Props = { roots: RootOption[]; defaults: FormDefaults; tmdbReady: boolean };

/** Add title, as a two-step panel: find it on TMDB (or skip), then choose where it goes. */
export function AddTitle({ roots, defaults, tmdbReady }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [picked, setPicked] = useState<TmdbHit | null>(null);
  /** True when adding without TMDB: name, year and type are typed in by hand. */
  const [manual, setManual] = useState(!tmdbReady);
  const [manualType, setManualType] = useState<MediaKind>("show");
  const [manualName, setManualName] = useState("");
  const [manualYear, setManualYear] = useState("");
  const [details, setDetails] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceRow[]>(() => [newSourceRow()]);
  const [options, setOptions] = useState<Options>(() => ({
    rootId: "",
    rootTouched: false,
    folder: "",
    folderTouched: false,
    seasonFolders: defaults.seasonFolders,
    monitored: true,
    naming: "{filename}",
  }));
  const [state, dispatch, pending] = useActionState<FormState, FormData>(addTitle, {});
  const errors = state.errors ?? {};
  const headingRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  const type: MediaKind = manual ? manualType : (picked?.type ?? "show");
  const name = manual ? manualName : (picked?.title ?? "");
  const yearNum = manual ? Number(manualYear) || null : (picked?.year ?? null);
  const synced = syncOptions(options, { type, name, year: yearNum }, roots, defaults);

  // Move focus to the step's heading so keyboard and screen-reader users land at the top.
  // (Not on first render: the search box has autofocus then.)
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);
  // Show the server's verdict.
  useEffect(() => {
    if (state.message) alertRef.current?.focus();
  }, [state]);

  function pick(hit: TmdbHit) {
    setPicked(hit);
    setManual(false);
    setDetails(null);
    void tmdbDetails(hit.type, hit.tmdbId).then((r) => setDetails(r.details?.summary ?? null));
  }

  function goToOptions(withManual: boolean) {
    setManual(withManual);
    if (withManual && !manualName && picked) {
      setManualName(picked.title);
      setManualYear(picked.year ? String(picked.year) : "");
      setManualType(picked.type);
    }
    setStep(2);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  }

  const panel = "card mx-auto flex w-full max-w-[720px] flex-col overflow-visible rounded-none border-x-0 shadow-sm md:rounded-lg md:border-x";

  if (roots.length === 0) {
    return (
      <div className={panel}>
        <Header step={step} headingRef={headingRef} />
        <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
          <span className="grid size-14 place-items-center rounded-md border border-dashed border-border-strong text-faint">
            <FolderPlus size={24} strokeWidth={1.5} aria-hidden="true" />
          </span>
          <p className="font-display text-xl text-fg">Add a root folder first</p>
          <p className="max-w-md text-sm text-muted">
            Root folders are where your shows and movies live, e.g. <code className="font-mono">/media/Kdrama</code>. Each title gets its own folder inside one.
          </p>
          <Link href="/settings/media" className="btn btn-primary">
            Open Media Management
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={panel}>
      <Header step={step} headingRef={headingRef} />

      {step === 1 ? (
        <>
          <div className="flex flex-col gap-4 p-4 md:p-5">
            {tmdbReady ? (
              <TmdbSearch picked={picked} onPick={pick} onConfirm={(h) => {
                  pick(h);
                  goToOptions(false);
                }} autoFocus onHint={(h) => h.url && setSources((rows) => withFirstUrl(rows, h.url!))} />
            ) : (
              <div className="flex gap-3 rounded-sm border border-border bg-surface-2 p-4 text-sm">
                <Info size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent-ink" aria-hidden="true" />
                <div className="space-y-2">
                  <p className="font-medium text-fg">TMDB isn&apos;t connected</p>
                  <p className="text-fg-2">
                    With a free TMDB API key, Riparr can search for the title and show its poster, overview and episode count. Add one under{" "}
                    <Link href="/settings/connections" className="link">
                      Settings → Connections
                    </Link>
                    , or add this title without TMDB.
                  </p>
                </div>
              </div>
            )}
          </div>
          <Footer>
            {tmdbReady ? (
              <span className="text-xs text-muted">
                Can&apos;t find it?{" "}
                <button type="button" className="link" onClick={() => goToOptions(true)}>
                  Add without TMDB
                </button>
              </span>
            ) : (
              <span />
            )}
            {tmdbReady ? (
              <button type="button" className="btn btn-primary" disabled={!picked} onClick={() => goToOptions(false)}>
                Continue
                <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => goToOptions(true)}>
                Add without TMDB
                <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
          </Footer>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col">
          <div className="flex flex-col gap-5 p-4 md:p-5">
            <input type="hidden" name="type" value={type} />
            {manual ? (
              <ManualFields
                type={manualType}
                setType={setManualType}
                name={manualName}
                setName={setManualName}
                year={manualYear}
                setYear={setManualYear}
                errors={errors}
                canGoBack={tmdbReady}
                onSearch={() => setStep(1)}
              />
            ) : (
              picked && (
                <>
                  <input type="hidden" name="tmdb_id" value={picked.tmdbId} />
                  <input type="hidden" name="name" value={picked.title} />
                  <input type="hidden" name="year" value={picked.year ?? ""} />
                  <input type="hidden" name="overview" value={picked.overview} />
                  <input type="hidden" name="poster_path" value={picked.posterPath ?? ""} />
                  <div className="flex items-center gap-3 rounded-sm border border-border bg-surface-2 p-2.5">
                    <TmdbPoster src={picked.posterUrl} seed={picked.tmdbId} name={picked.title} year={picked.year} className="w-10 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-fg">
                        {picked.title}
                        {picked.year ? <span className="font-normal text-muted"> ({picked.year})</span> : null}{" "}
                        <Tag>{picked.type === "show" ? "Show" : "Movie"}</Tag>
                      </p>
                      <p className="text-xs text-muted">{details ?? "TMDB match"}</p>
                    </div>
                    <button type="button" className="btn btn-ghost min-h-8 px-2 text-[13px]" onClick={() => setStep(1)}>
                      Change
                    </button>
                  </div>
                  <Errors errors={errors.tmdb_id} />
                </>
              )
            )}

            <TitleOptions type={type} name={name} year={yearNum} roots={roots} options={synced} onChange={setOptions} errors={errors} />

            <SourcesFields rows={sources} onChange={setSources} errors={errors} />
          </div>

          {state.message && (
            <div
              ref={alertRef}
              tabIndex={-1}
              role="alert"
              className="mx-4 mb-4 flex gap-2 rounded-sm bg-critical-soft px-3 py-2 text-sm text-critical md:mx-5"
            >
              <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              {state.message}
            </div>
          )}

          <Footer>
            <button type="button" className="btn" onClick={() => setStep(1)}>
              <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
              Back
            </button>
            <button type="submit" className="btn btn-primary min-w-0" disabled={pending}>
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
              <span className="truncate">{pending ? "Adding…" : name.trim() ? `Add ${name.trim()}` : "Add title"}</span>
            </button>
          </Footer>
        </form>
      )}
    </div>
  );
}

/** Puts a pasted container URL into the first empty source row. */
function withFirstUrl(rows: SourceRow[], url: string): SourceRow[] {
  if (rows.some((r) => r.url.trim() === url)) return rows;
  const i = rows.findIndex((r) => !r.url.trim());
  return i === -1 ? [...rows, newSourceRow(url)] : rows.map((r, j) => (j === i ? { ...r, url } : r));
}

function Header({ step, headingRef }: { step: 1 | 2; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-border px-4 pb-3.5 pt-4 md:px-5 md:pt-5">
      <div>
        <h1 ref={headingRef} tabIndex={-1} className="font-display text-2xl font-medium leading-tight text-fg focus:outline-none md:text-[26px]">
          Add title
        </h1>
        <p className="mt-0.5 text-xs text-muted">
          <span className="font-medium text-fg">{step === 1 ? "1. Find it on TMDB" : "2. Choose where it goes"}</span> · step {step} of 2
        </p>
      </div>
      <Link href="/" className="btn btn-ghost -mr-2 min-h-9 px-2" aria-label="Close and go back to the dashboard">
        <X size={18} strokeWidth={1.75} aria-hidden="true" />
      </Link>
    </header>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t md:rounded-b-lg border-border bg-surface-2 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] md:static md:px-5">
      {children}
    </footer>
  );
}

function ManualFields({
  type,
  setType,
  name,
  setName,
  year,
  setYear,
  errors,
  canGoBack,
  onSearch,
}: {
  type: MediaKind;
  setType: (t: MediaKind) => void;
  name: string;
  setName: (v: string) => void;
  year: string;
  setYear: (v: string) => void;
  errors: Record<string, string[] | undefined>;
  canGoBack: boolean;
  onSearch: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          name="manual_type"
          label="Type"
          value={type}
          options={[
            { value: "show", label: "Show" },
            { value: "movie", label: "Movie" },
          ]}
          onChange={setType}
        />
        {canGoBack && (
          <button type="button" className="link text-xs" onClick={onSearch}>
            Search TMDB instead
          </button>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_8rem]">
        <div className="space-y-1.5">
          <label htmlFor="add-name" className="block text-[13px] font-medium text-fg-2">
            Name
          </label>
          <input
            id="add-name"
            name="name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === "show" ? "Doctor X" : "Harbor Lights"}
            aria-invalid={!!errors.name}
            autoComplete="off"
            required
             
            autoFocus
          />
          <Errors errors={errors.name} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="add-year" className="block text-[13px] font-medium text-fg-2">
            Year
          </label>
          <input
            id="add-year"
            name="year"
            inputMode="numeric"
            className="input"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="2026"
            aria-invalid={!!errors.year}
            autoComplete="off"
          />
          <Errors errors={errors.year} />
        </div>
      </div>
    </div>
  );
}
