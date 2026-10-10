"use client";

import { useActionState } from "react";
import { addLinksManually, addSource, importDlc, type AddLinksState, type SourceFormState } from "./actions";

export function AddLinksForm({ titleId }: { titleId: number }) {
  const [state, action, pending] = useActionState<AddLinksState, FormData>(addLinksManually, {});
  return (
    <form action={action} className="space-y-3 p-4">
      <input type="hidden" name="id" value={titleId} />
      <textarea
        name="urls"
        rows={3}
        className="input font-mono"
        placeholder={"https://pixeldrain.com/u/…\nhttps://gofile.io/d/…"}
        required
      />
      <div className="flex flex-wrap items-center gap-3">
        <input name="archive_password" className="input max-w-xs" placeholder="Archive password (optional)" autoComplete="off" />
        <button className="btn" disabled={pending}>
          {pending ? "Adding…" : "Add links"}
        </button>
        {state.message && <span className="text-sm text-good">{state.message}</span>}
        {state.error && <span className="text-sm text-critical">{state.error}</span>}
      </div>
    </form>
  );
}

export function ImportDlcForm({ titleId }: { titleId: number }) {
  const [state, action, pending] = useActionState<AddLinksState, FormData>(importDlc, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3 border-t border-border p-4">
      <input type="hidden" name="id" value={titleId} />
      <span className="text-sm font-medium">Import a .dlc file</span>
      <input type="file" name="dlc" accept=".dlc,application/octet-stream,text/plain" className="text-sm" required />
      <button className="btn" disabled={pending}>
        {pending ? "Importing…" : "Import"}
      </button>
      {state.message && <span className="text-sm text-good">{state.message}</span>}
      {state.error && <span className="text-sm text-critical">{state.error}</span>}
      <p className="w-full text-xs text-muted">Decrypting uses JDownloader&apos;s DLC service, so Riparr needs internet access to it.</p>
    </form>
  );
}

export function AddSourceForm({ titleId }: { titleId: number }) {
  const [state, action, pending] = useActionState<SourceFormState, FormData>(addSource, {});
  return (
    <form action={action} className="grid gap-3 border-t border-border p-4 sm:grid-cols-[1fr_10rem_7rem_auto] sm:items-end">
      <input type="hidden" name="title_id" value={titleId} />
      <label className="block space-y-1">
        <span className="text-sm font-medium">Source page</span>
        <input name="url" type="url" className="input" placeholder="https://mkvdrama.net/c/…" required />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Password</span>
        <input name="password" className="input" autoComplete="off" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Every (min)</span>
        <input name="poll_interval_min" type="number" min={5} defaultValue={60} className="input" />
      </label>
      <button className="btn" disabled={pending}>
        {pending ? "Adding…" : "Add source"}
      </button>
      <label className="flex items-center gap-2 text-sm sm:col-span-4">
        <input type="checkbox" name="poll" defaultChecked /> Check the page for new links
        {state.message && <span className="text-good">{state.message}</span>}
        {state.error && <span className="text-critical">{state.error}</span>}
      </label>
    </form>
  );
}
