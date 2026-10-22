"use client";

import { useActionState, useState } from "react";
import { FolderSearch, Plus, Trash2 } from "lucide-react";
import { Field, PageHeader, ProgressBar, StatusPill, SubmitButton, SwitchRow, formatBytes } from "../../_kit";
import { Section, SettingsCard } from "../_ui/section";
import { SaveActions, useSettingsForm } from "../_ui/form";
import { addRootFolderAction, removeRootFolderAction, saveMediaSettings, type RootFolderState } from "../actions";
import { FolderBrowser } from "./folder-browser";

export type RootRow = {
  id: number;
  path: string;
  accessible: boolean;
  freeBytes: number | null;
  totalBytes: number | null;
  titleCount: number;
  /** Another root folder this one is inside of or contains. */
  overlaps: string | null;
};

type MediaSettings = {
  defaultShowRootId: number | null;
  defaultMovieRootId: number | null;
  defaultSeasonFolders: boolean;
  cnlEnabled: boolean;
};

const FORM_ID = "settings-media";

export function MediaForm({ roots, settings }: { roots: RootRow[]; settings: MediaSettings }) {
  const form = useSettingsForm(saveMediaSettings);
  const { errors } = form;
  const showDefault = settings.defaultShowRootId ?? roots[0]?.id;
  const movieDefault = settings.defaultMovieRootId ?? roots[0]?.id;

  return (
    <>
      <PageHeader
        title="Media Management"
        subtitle="Where titles are stored, and the defaults for new ones."
        actions={<SaveActions formId={FORM_ID} pending={form.pending} state={form.state} />}
      />
      <SettingsCard>
        <Section
          title="Root folders"
          intro={
            <>
              Top-level library folders, as paths inside Riparr&apos;s container (e.g. your NAS <code className="font-mono">Videos</code> share
              mounted at <code className="font-mono">/media</code>, with <code className="font-mono">/media/Kdrama</code> and{" "}
              <code className="font-mono">/media/Movies</code>). Each title lives in its own folder under one of these.
            </>
          }
        >
          {roots.length > 0 ? (
            <ul className="divide-y divide-border overflow-hidden rounded-sm border border-border">
              {roots.map((r) => (
                <RootFolderRow key={r.id} root={r} isShowDefault={r.id === showDefault} isMovieDefault={r.id === movieDefault} />
              ))}
            </ul>
          ) : (
            <p className="rounded-sm border border-dashed border-border-strong px-4 py-3 text-sm text-muted">
              No root folders yet. Add one below before adding titles.
            </p>
          )}
          <AddRootFolder />
        </Section>

        <form id={FORM_ID} action={form.formAction}>
          <Section title="New titles" intro="Defaults for titles you add. You can change them per title.">
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["defaultShowRootId", "Root folder for new shows"],
                  ["defaultMovieRootId", "Root folder for new movies"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label} htmlFor={key} errors={errors[key]}>
                  <select id={key} name={key} className="input" defaultValue={form.text(key, settings[key])}>
                    <option value="">{roots.length ? "First root folder" : "Add a root folder first"}</option>
                    {roots.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.path}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
            <SwitchRow
              name="defaultSeasonFolders"
              label="Use season folders for new shows"
              hint="Doctor X/Season 01/… instead of Doctor X/…"
              defaultChecked={form.checked("defaultSeasonFolders", settings.defaultSeasonFolders)}
            />
          </Section>

          <Section
            title="Click'n'Load"
            intro="Receive links from the Click'n'Load (CNL) button on container pages, as JDownloader does."
          >
            <SwitchRow
              name="cnlEnabled"
              label="Listen on port 9666"
              hint={
                <>
                  Restart Riparr to apply. Links from a page you already track are added to that title; links from pages you
                  don&apos;t track yet become a new show in the default show root folder.
                </>
              }
              defaultChecked={form.checked("cnlEnabled", settings.cnlEnabled)}
            />
          </Section>
        </form>
      </SettingsCard>
    </>
  );
}

function RootFolderRow({ root: r, isShowDefault, isMovieDefault }: { root: RootRow; isShowDefault: boolean; isMovieDefault: boolean }) {
  const used = r.totalBytes && r.freeBytes != null ? r.totalBytes - r.freeBytes : 0;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-3.5 py-3 md:grid-cols-[minmax(0,1fr)_200px_auto]">
      <div className="min-w-0">
        <div className="break-all font-mono text-[13px] font-medium text-fg">{r.path}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>
            {r.titleCount} title{r.titleCount === 1 ? "" : "s"}
          </span>
          {isShowDefault && <span className="rounded-pill bg-info-soft px-2 py-px text-info">Default for shows</span>}
          {isMovieDefault && <span className="rounded-pill bg-info-soft px-2 py-px text-info">Default for movies</span>}
        </div>
        {r.overlaps && (
          <p className="mt-1.5 text-xs text-warn">
            {r.overlaps.startsWith(`${r.path}/`) ? `Contains the root folder ${r.overlaps}.` : `Inside the root folder ${r.overlaps}.`} Nested root
            folders make it easy to file a title in the wrong place; remove the one you don&apos;t use.
          </p>
        )}
      </div>
      <div className="col-span-2 row-start-2 flex flex-col gap-1.5 text-xs tabular-nums text-muted md:col-span-1 md:col-start-2 md:row-start-1">
        {r.accessible ? (
          <>
            <span>
              <b className="font-medium text-fg">{formatBytes(r.freeBytes)} free</b>
              {r.totalBytes ? ` of ${formatBytes(r.totalBytes)}` : ""}
            </span>
            {r.totalBytes ? <ProgressBar size="sm" total={r.totalBytes} segments={[{ value: used, tone: "done" }]} label={`${r.path} used space`} /> : null}
          </>
        ) : (
          <span>
            <StatusPill state="error" label="Not reachable" />
            <span className="mt-1 block">Missing or not writable; check the volume mapping.</span>
          </span>
        )}
      </div>
      <form action={removeRootFolderAction} className="col-start-2 row-start-1 md:col-start-3">
        <input type="hidden" name="id" value={r.id} />
        <SubmitButton
          className="btn btn-ghost btn-danger px-2"
          disabled={r.titleCount > 0}
          aria-label={`Remove ${r.path}`}
          title={r.titleCount > 0 ? "Titles still use this folder" : `Remove ${r.path}`}
        >
          <Trash2 size={16} aria-hidden="true" />
        </SubmitButton>
      </form>
    </li>
  );
}

function AddRootFolder() {
  const [path, setPath] = useState("");
  const [browseFrom, setBrowseFrom] = useState<string | null>(null);
  const [state, action, pending] = useActionState<RootFolderState, FormData>(async (prev, formData) => {
    const result = await addRootFolderAction(prev, formData);
    if (result.message) {
      setPath("");
      setBrowseFrom(null);
    }
    return result;
  }, {});

  return (
    <form action={action} className="flex flex-col gap-2">
      <label htmlFor="root-path" className="text-[13px] font-medium text-fg-2">
        Add a root folder
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="root-path"
          name="path"
          className="input input-mono min-w-0 flex-1 basis-56"
          placeholder="/media/Anime"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          autoComplete="off"
          required
        />
        <button type="button" className="btn" aria-expanded={browseFrom !== null} onClick={() => setBrowseFrom(browseFrom === null ? path || "/" : null)}>
          <FolderSearch size={15} aria-hidden="true" />
          Browse
        </button>
        <button className="btn" disabled={pending}>
          <Plus size={15} aria-hidden="true" />
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {browseFrom !== null && (
        <FolderBrowser
          start={browseFrom}
          onClose={() => setBrowseFrom(null)}
          onPick={(p) => {
            setPath(p);
            setBrowseFrom(null);
          }}
        />
      )}
      {state.error ? (
        <p role="alert" className="text-xs text-critical">
          {state.error}
        </p>
      ) : state.message ? (
        <p role="status" className="text-xs text-good">
          {state.message}
        </p>
      ) : (
        <p className="text-xs text-muted">The folder must exist inside the container and be writable by Riparr.</p>
      )}
    </form>
  );
}
