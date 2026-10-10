"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Search, Trash2, TriangleAlert, Unlink } from "lucide-react";
import type { Title } from "@/lib/titles";
import { Card, Poster, Tag } from "../_kit";
import { editTitle, removeTitle } from "./actions";
import { Errors, Segmented, TmdbPoster } from "./_add/bits";
import type { MediaKind } from "./_add/path-preview";
import { TitleOptions, type Options } from "./_add/title-options";
import { TmdbSearch } from "./_add/tmdb-search";
import type { FormDefaults, FormState, RootOption, TmdbHit } from "./_add/types";

export type EditableTitle = Pick<
  Title,
  "id" | "type" | "name" | "year" | "tmdb_id" | "overview" | "poster_path" | "root_folder_id" | "folder" | "season_folders" | "naming" | "monitored"
>;

type Match = { tmdbId: number; type: MediaKind; title: string; year: number | null; overview: string; posterPath: string | null; posterUrl: string | null };

/** Edit a title's TMDB match, name, folder and naming. Sources are managed on the title page. */
export function EditTitleForm({ title, roots, tmdbReady }: { title: EditableTitle; roots: RootOption[]; defaults: FormDefaults; tmdbReady: boolean }) {
  const [state, dispatch, pending] = useActionState<FormState, FormData>(editTitle, {});
  const errors = state.errors ?? {};
  const [match, setMatch] = useState<Match | null>(
    title.tmdb_id
      ? { tmdbId: title.tmdb_id, type: title.type, title: title.name, year: title.year, overview: title.overview ?? "", posterPath: title.poster_path, posterUrl: null }
      : null,
  );
  const [searching, setSearching] = useState(false);
  const [manualType, setManualType] = useState<MediaKind>(title.type);
  const [name, setName] = useState(title.name);
  const [year, setYear] = useState(title.year ? String(title.year) : "");
  const [options, setOptions] = useState<Options>({
    rootId: String(roots.some((r) => r.id === title.root_folder_id) ? title.root_folder_id : (roots[0]?.id ?? "")),
    rootTouched: true,
    folder: title.folder,
    folderTouched: true,
    seasonFolders: title.season_folders === 1,
    monitored: title.monitored === 1,
    naming: title.naming,
  });
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.message) alertRef.current?.focus();
  }, [state]);

  const type: MediaKind = match?.type ?? manualType;
  const isCurrent = match?.tmdbId === title.tmdb_id && match?.type === title.type;
  const rootKnown = roots.some((r) => r.id === title.root_folder_id);

  function pick(hit: TmdbHit) {
    setMatch({ tmdbId: hit.tmdbId, type: hit.type, title: hit.title, year: hit.year, overview: hit.overview, posterPath: hit.posterPath, posterUrl: hit.posterUrl });
    setName(hit.title);
    setYear(hit.year ? String(hit.year) : "");
    setSearching(false);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      <input type="hidden" name="id" value={title.id} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="tmdb_id" value={match?.tmdbId ?? ""} />
      <input type="hidden" name="overview" value={match?.overview ?? ""} />
      <input type="hidden" name="poster_path" value={match?.posterPath ?? ""} />

      <Card title="TMDB match">
        <div className="flex flex-col gap-4">
          {match ? (
            <div className="flex items-center gap-3">
              {isCurrent ? (
                <Poster id={title.id} name={match.title} year={match.year} hasPoster={!!title.poster_path} className="w-12 shrink-0" />
              ) : (
                <TmdbPoster src={match.posterUrl} seed={match.tmdbId} name={match.title} year={match.year} className="w-12 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-fg">
                  {match.title}
                  {match.year ? <span className="font-normal text-muted"> ({match.year})</span> : null} <Tag>{match.type === "show" ? "Show" : "Movie"}</Tag>
                </p>
                <p className="text-xs text-muted">
                  {isCurrent ? `TMDB #${match.tmdbId}` : "New match. Poster, overview and episode count update when you save."}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">
              Not matched to TMDB, so there&apos;s no poster or episode count.
              {!tmdbReady && (
                <>
                  {" "}
                  Add a TMDB API key under{" "}
                  <Link href="/settings/connections" className="link">
                    Settings → Connections
                  </Link>{" "}
                  to match it.
                </>
              )}
            </p>
          )}
          <Errors errors={errors.tmdb_id} />

          <div className="flex flex-wrap gap-2">
            {tmdbReady && (
              <button type="button" className="btn min-h-8 text-[13px]" aria-expanded={searching} onClick={() => setSearching(!searching)}>
                <Search size={15} strokeWidth={1.75} aria-hidden="true" />
                {searching ? "Close search" : match ? "Change TMDB match" : "Find on TMDB"}
              </button>
            )}
            {match && !searching && (
              <button type="button" className="btn btn-ghost min-h-8 text-[13px]" onClick={() => setMatch(null)}>
                <Unlink size={15} strokeWidth={1.75} aria-hidden="true" />
                Remove match
              </button>
            )}
          </div>

          {searching && (
            <div className="rounded-sm border border-border p-3">
              <TmdbSearch picked={null} onPick={pick} initialQuery={name} initialKind={type} excludeId={title.id} autoFocus />
            </div>
          )}
        </div>
      </Card>

      <Card title="Title">
        <div className="flex flex-col gap-4">
          {!match && (
            <Segmented
              name="manual_type"
              label="Type"
              value={manualType}
              options={[
                { value: "show", label: "Show" },
                { value: "movie", label: "Movie" },
              ]}
              onChange={setManualType}
            />
          )}
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_8rem]">
            <div className="space-y-1.5">
              <label htmlFor="edit-name" className="block text-[13px] font-medium text-fg-2">
                Name
              </label>
              <input id="edit-name" name="name" className="input" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} autoComplete="off" />
              {errors.name ? <Errors errors={errors.name} /> : <p className="text-xs text-muted">Used for the {"{title}"} naming token.</p>}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="edit-year" className="block text-[13px] font-medium text-fg-2">
                Year
              </label>
              <input
                id="edit-year"
                name="year"
                inputMode="numeric"
                className="input"
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                aria-invalid={!!errors.year}
                autoComplete="off"
              />
              <Errors errors={errors.year} />
            </div>
          </div>
        </div>
      </Card>

      <Card title="Where it goes">
        {!rootKnown && <p className="mb-3 text-sm text-critical">This title&apos;s root folder was removed. Choose another one.</p>}
        <TitleOptions type={type} name={name} year={Number(year) || null} roots={roots} options={options} onChange={setOptions} errors={errors} editing />
      </Card>

      {state.message && (
        <div ref={alertRef} tabIndex={-1} role="alert" className="flex gap-2 rounded-sm bg-critical-soft px-3 py-2 text-sm text-critical">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {state.message}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Link href={`/titles/${title.id}`} className="btn btn-ghost">
          Cancel
        </Link>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          <Check size={16} strokeWidth={1.75} aria-hidden="true" />
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

/** Delete with an inline confirm (no browser dialog). Files on disk are kept. */
export function DeleteTitle({ id, name }: { id: number; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  return (
    <Card title="Delete title" className={confirming ? "border-critical bg-critical-soft" : ""}>
      <form action={removeTitle} className="flex flex-col gap-3 md:flex-row md:items-center">
        <input type="hidden" name="id" value={id} />
        <p className="min-w-0 flex-1 text-sm text-fg-2">
          {confirming
            ? `Delete ${name}? Its sources, links and history are removed from Riparr.`
            : "Removes the title, its sources and download history from Riparr. Files already downloaded stay on disk."}
        </p>
        {confirming ? (
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button ref={confirmRef} type="submit" className="btn btn-danger border-critical">
              <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
              Delete
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-danger self-start md:self-auto" onClick={() => setConfirming(true)}>
            <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
            Delete title
          </button>
        )}
      </form>
    </Card>
  );
}
