"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { addSource, type SourceFormState } from "../titles/actions";

/** Adds a container page to a title (restyled version of the old inline form). */
export function AddSourceForm({ titleId }: { titleId: number }) {
  const [state, action, pending] = useActionState<SourceFormState, FormData>(addSource, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="title_id" value={titleId} />
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_7rem]">
        <label className="block space-y-1.5">
          <span className="block text-[13px] font-medium text-fg-2">Source page</span>
          <input name="url" type="url" className="input input-mono" placeholder="https://mkvdrama.net/c/…" required />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-[13px] font-medium text-fg-2">Password</span>
          <input name="password" className="input" autoComplete="off" placeholder="Optional" />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-[13px] font-medium text-fg-2">Every (min)</span>
          <input name="poll_interval_min" type="number" min={5} defaultValue={60} className="input tabular-nums" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="inline-flex min-h-9 items-center gap-2 text-sm text-fg-2">
          <input type="checkbox" name="poll" defaultChecked className="size-4 accent-[var(--accent)]" />
          Check the page for new links
        </label>
        <span className="flex-1" />
        <p aria-live="polite" className="text-sm">
          {state.message && <span className="text-good">{state.message}</span>}
          {state.error && <span className="text-critical">{state.error}</span>}
        </p>
        <button className="btn" disabled={pending}>
          <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
          {pending ? "Adding…" : "Add source"}
        </button>
      </div>
    </form>
  );
}
