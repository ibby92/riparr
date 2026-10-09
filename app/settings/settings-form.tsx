"use client";

import { useActionState } from "react";
import type { AppSettings } from "@/lib/settings";
import { saveAppSettings, type SettingsState } from "./actions";

function Field({ label, hint, errors, children }: { label: string; hint?: string; errors?: string[]; children: React.ReactNode }) {
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

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveAppSettings, {});
  const errors = state.errors ?? {};
  const mb = settings.bytesPerSecond / 1024 / 1024;

  return (
    <form action={action} className="card space-y-6 p-5">
      <fieldset className="space-y-4">
        <legend className="mb-2 font-medium">Downloads</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Simultaneous downloads" errors={errors.concurrency}>
            <input name="concurrency" type="number" min={1} max={20} className="input" defaultValue={settings.concurrency} />
          </Field>
          <Field label="Per host" errors={errors.perHost}>
            <input name="perHost" type="number" min={1} max={10} className="input" defaultValue={settings.perHost} />
          </Field>
          <Field label="Speed limit per download (MB/s)" hint="0 = unlimited" errors={errors.mbPerSecond}>
            <input name="mbPerSecond" type="number" min={0} step="0.1" className="input" defaultValue={Number(mb.toFixed(2))} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 font-medium">Click&apos;n&apos;Load</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="cnlEnabled" defaultChecked={settings.cnlEnabled} />
          Listen on port 9666 (restart Riparr to apply)
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Folder for links from unknown pages"
            hint="Links from a page you already watch use that container's folder"
            errors={errors.cnlTargetDir}
          >
            <input name="cnlTargetDir" className="input" defaultValue={settings.cnlTargetDir} />
          </Field>
          <Field label="Naming template" errors={errors.cnlTemplate}>
            <input name="cnlTemplate" className="input font-mono" defaultValue={settings.cnlTemplate} />
          </Field>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        {state.saved && !pending && <span className="text-sm text-emerald-500">Saved</span>}
      </div>
    </form>
  );
}
