"use client";

import { useId, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { Errors, Switch } from "./bits";
import { defaultFolder, NAMING_TOKENS, previewPath, type MediaKind } from "./path-preview";
import type { FormDefaults, RootOption } from "./types";

export type Options = {
  rootId: string;
  /** False until the user picks a root: until then it follows the per-type default. */
  rootTouched: boolean;
  folder: string;
  /** False until the user edits the folder: until then it follows the name. */
  folderTouched: boolean;
  seasonFolders: boolean;
  monitored: boolean;
  naming: string;
};

export function defaultRootId(type: MediaKind, roots: RootOption[], defaults: FormDefaults): string {
  const preferred = type === "movie" ? defaults.movieRootId : defaults.showRootId;
  const id = roots.some((r) => r.id === preferred) ? preferred : roots[0]?.id;
  return id ? String(id) : "";
}

/** Keeps auto-filled fields (root, folder) in step with the title's type, name and year. */
export function syncOptions(o: Options, t: { type: MediaKind; name: string; year: number | null }, roots: RootOption[], defaults: FormDefaults): Options {
  return {
    ...o,
    rootId: o.rootTouched ? o.rootId : defaultRootId(t.type, roots, defaults),
    folder: o.folderTouched ? o.folder : t.name.trim() ? defaultFolder(t.name.trim(), t.type, t.year) : "",
  };
}

/**
 * Where the title goes and how it's tracked: root folder, folder, season folders, monitored,
 * naming (collapsed) and a live preview of where an episode would land.
 */
export function TitleOptions({
  type,
  name,
  year,
  roots,
  options: o,
  onChange,
  errors,
  editing,
}: {
  type: MediaKind;
  name: string;
  year: number | null;
  roots: RootOption[];
  options: Options;
  onChange: (o: Options) => void;
  errors: Record<string, string[] | undefined>;
  editing?: boolean;
}) {
  const id = useId();
  const namingRef = useRef<HTMLInputElement>(null);
  const root = roots.find((r) => String(r.id) === o.rootId);
  const preview = previewPath({
    rootPath: root?.path ?? "",
    folder: o.folder,
    type,
    seasonFolders: o.seasonFolders,
    naming: o.naming,
    name,
    year,
  });
  const set = (patch: Partial<Options>) => onChange({ ...o, ...patch });

  function insertToken(token: string) {
    const el = namingRef.current;
    const start = el?.selectionStart ?? o.naming.length;
    const end = el?.selectionEnd ?? o.naming.length;
    const next = o.naming.slice(0, start) + token + o.naming.slice(end);
    set({ naming: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const customNaming = o.naming.trim() !== "" && o.naming.trim() !== "{filename}";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-root`} className="block text-[13px] font-medium text-fg-2">
            Root folder
          </label>
          <select
            id={`${id}-root`}
            name="root_folder_id"
            className="input"
            value={o.rootId}
            onChange={(e) => set({ rootId: e.target.value, rootTouched: true })}
            aria-invalid={!!errors.root_folder_id}
          >
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.path}
                {r.free ? ` · ${r.free} free` : r.accessible ? "" : " · not reachable"}
              </option>
            ))}
          </select>
          <Errors errors={errors.root_folder_id} />
          {root && !root.accessible && !errors.root_folder_id && (
            <p className="text-xs text-warn">Riparr can&apos;t write to this folder right now. Check the Docker volume.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-folder`} className="block text-[13px] font-medium text-fg-2">
            Folder name
          </label>
          <input
            id={`${id}-folder`}
            name="folder"
            className="input"
            value={o.folder}
            placeholder={name ? defaultFolder(name, type, year) : "Doctor X"}
            onChange={(e) => set({ folder: e.target.value, folderTouched: true })}
            aria-invalid={!!errors.folder}
            aria-describedby={`${id}-folder-help`}
            autoComplete="off"
          />
          {errors.folder ? (
            <Errors id={`${id}-folder-help`} errors={errors.folder} />
          ) : (
            <p id={`${id}-folder-help`} className="text-xs text-muted">
              Inside the root folder.{" "}
              {o.folderTouched && name.trim() && (
                <button type="button" className="link" onClick={() => set({ folderTouched: false, folder: defaultFolder(name.trim(), type, year) })}>
                  Use the default
                </button>
              )}
            </p>
          )}
        </div>
      </div>

      {editing && <p className="-mt-1 text-xs text-muted">Changing the root folder or folder name only affects new downloads. Files already downloaded stay where they are.</p>}

      <div className="divide-y divide-border">
        {type === "show" && (
          <Switch
            id={`${id}-season`}
            name="season_folders"
            label="Use season folders"
            hint="Put episodes in Season 01, Season 02 and so on."
            checked={o.seasonFolders}
            onChange={(v) => set({ seasonFolders: v })}
          />
        )}
        <Switch
          id={`${id}-monitored`}
          name="monitored"
          label="Monitor"
          hint={type === "show" ? "Check sources and download new episodes as they appear." : "Check sources and download the movie when it appears."}
          checked={o.monitored}
          onChange={(v) => set({ monitored: v })}
        />
      </div>

      <details className="group rounded-sm border border-border" open={customNaming || !!errors.naming}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
          <ChevronRight size={16} strokeWidth={1.75} className="text-muted transition-transform group-open:rotate-90" aria-hidden="true" />
          File naming
          <span className="ml-auto truncate font-mono text-xs font-normal text-muted">{o.naming.trim() || "{filename}"}</span>
        </summary>
        <div className="space-y-2 border-t border-border p-3">
          <label htmlFor={`${id}-naming`} className="block text-[13px] font-medium text-fg-2">
            File name
          </label>
          <input
            ref={namingRef}
            id={`${id}-naming`}
            name="naming"
            className="input input-mono"
            value={o.naming}
            onChange={(e) => set({ naming: e.target.value })}
            aria-invalid={!!errors.naming || !preview.namingOk}
            aria-describedby={`${id}-naming-help`}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Insert a token">
            {NAMING_TOKENS.map((t) => (
              <button
                key={t.token}
                type="button"
                title={t.description}
                onClick={() => insertToken(t.token)}
                className="rounded-[6px] border border-dashed border-border-strong bg-surface-2 px-2 py-0.5 font-mono text-xs text-fg-2 hover:border-solid hover:text-fg"
              >
                {t.token}
              </button>
            ))}
          </div>
          {errors.naming ? (
            <Errors id={`${id}-naming-help`} errors={errors.naming} />
          ) : (
            <p id={`${id}-naming-help`} className={`text-xs ${preview.namingOk ? "text-muted" : "text-critical"}`}>
              {preview.namingOk
                ? "{filename} keeps each file's original name. A / makes a sub-folder."
                : "Include {filename} or {name} so files from the same episode don't overwrite each other."}
            </p>
          )}
        </div>
      </details>

      <div className="space-y-1.5">
        <span className="block text-[13px] font-medium text-fg-2">{type === "show" ? "Episodes will be saved as" : "The movie will be saved as"}</span>
        <p
          aria-live="polite"
          className="rounded-sm border border-border bg-surface-2 px-3 py-2.5 font-mono text-[12.5px] text-fg-2 [overflow-wrap:anywhere]"
        >
          <span className="text-muted">{preview.root === "/" ? "/" : `${preview.root}/`}</span>
          {preview.folder ? <span className="font-medium text-fg">{preview.folder}</span> : <span className="text-critical">(folder name needed)</span>}/
          {preview.season && (
            <>
              <span className="text-accent-ink">{preview.season}</span>/
            </>
          )}
          {preview.file}
        </p>
      </div>
    </div>
  );
}
