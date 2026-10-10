"use client";

import { useActionState, useState } from "react";
import type { Title } from "@/lib/titles";
import { TEMPLATE_TOKENS } from "@/lib/paths";
import { saveTitle, type FormState } from "./actions";

export type RootOption = { id: number; path: string; free: string | null };

type Props = {
  title?: Pick<
    Title,
    "id" | "type" | "name" | "year" | "tmdb_id" | "root_folder_id" | "folder" | "season_folders" | "naming" | "monitored"
  >;
  roots: RootOption[];
  defaults: { showRootId: number | null; movieRootId: number | null; seasonFolders: boolean };
};

function Field({
  label,
  hint,
  errors,
  children,
}: {
  label: string;
  hint?: string;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {errors?.map((e) => (
        <p key={e} className="text-xs text-red-500">
          {e}
        </p>
      ))}
      {hint && !errors?.length && <p className="text-xs text-muted">{hint}</p>}
    </label>
  );
}

export function TitleForm({ title, roots, defaults }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveTitle, {});
  const errors = state.errors ?? {};
  // After a failed submit, prefer what the user typed over the saved values.
  const v = state.values;
  const initial = (key: string, saved: string | number | null | undefined) => v?.[key] ?? saved ?? "";
  const [type, setType] = useState<"show" | "movie">((v?.type as "show" | "movie") ?? title?.type ?? "show");
  const defaultRoot = (type === "movie" ? defaults.movieRootId : defaults.showRootId) ?? roots[0]?.id;

  if (roots.length === 0) {
    return (
      <div className="card max-w-2xl p-5 text-sm">
        Add a root folder first, under <a href="/settings#media" className="text-accent underline">Settings → Media Management</a>.
        It&apos;s where your shows and movies live, e.g. <code>/media/Kdrama</code>.
      </div>
    );
  }

  return (
    <form action={action} className="card max-w-2xl space-y-4 p-5">
      {title && <input type="hidden" name="id" value={title.id} />}

      <fieldset className="flex gap-4 text-sm">
        <legend className="mb-1 text-sm font-medium">Type</legend>
        {(["show", "movie"] as const).map((t) => (
          <label key={t} className="flex items-center gap-2">
            <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} />
            {t === "show" ? "Show" : "Movie"}
          </label>
        ))}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label="Name" errors={errors.name}>
          <input name="name" className="input" defaultValue={initial("name", title?.name)} required />
        </Field>
        <Field label="Year" errors={errors.year}>
          <input name="year" type="number" min={1870} max={2200} className="input" defaultValue={initial("year", title?.year)} />
        </Field>
      </div>
      <input type="hidden" name="tmdb_id" value={initial("tmdb_id", title?.tmdb_id)} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Root folder" errors={errors.root_folder_id}>
          <select
            key={type}
            name="root_folder_id"
            className="input"
            defaultValue={initial("root_folder_id", title?.root_folder_id ?? defaultRoot)}
          >
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.path}
                {r.free ? ` (${r.free} free)` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Folder" hint="Inside the root folder. Leave empty to use the name." errors={errors.folder}>
          <input name="folder" className="input" defaultValue={initial("folder", title?.folder)} placeholder="Doctor X" />
        </Field>
      </div>

      {type === "show" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="season_folders"
            defaultChecked={v ? v.season_folders === "on" : title ? title.season_folders === 1 : defaults.seasonFolders}
          />
          Season folders (<code>Season 01/</code>)
        </label>
      )}

      <Field
        label="File naming"
        hint={`Inside the title${type === "show" ? " (and season)" : ""} folder. Tokens: ${TEMPLATE_TOKENS.map((t) => t.token).join(" ")}`}
        errors={errors.naming}
      >
        <input name="naming" className="input font-mono" defaultValue={initial("naming", title?.naming ?? "{filename}")} required />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="monitored" defaultChecked={v ? v.monitored === "on" : title ? title.monitored === 1 : true} />
        Monitored: check sources and download new content
      </label>

      {!title && (
        <fieldset className="space-y-3 border-t border-border pt-4">
          <legend className="text-sm font-medium">First source (optional)</legend>
          <Field label="Source page" hint="A container page that lists this title's links (mkvdrama, viewcrate, …)" errors={errors.source_url}>
            <input name="source_url" type="url" className="input" defaultValue={initial("source_url", "")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Password" hint="Optional: page or archive password">
              <input name="source_password" className="input" defaultValue={initial("source_password", "")} autoComplete="off" />
            </Field>
            <Field label="Check every (minutes)" errors={errors.source_poll_interval_min}>
              <input name="source_poll_interval_min" type="number" min={5} className="input" defaultValue={initial("source_poll_interval_min", 60)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="source_poll" defaultChecked={v ? v.source_poll === "on" : true} />
            Check the page for new links (turn off for captcha pages fed by Click&apos;n&apos;Load)
          </label>
        </fieldset>
      )}

      {state.message && <p className="text-sm text-red-500">{state.message}</p>}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving…" : title ? "Save changes" : "Add title"}
      </button>
    </form>
  );
}
