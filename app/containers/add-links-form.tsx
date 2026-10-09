"use client";

import { useActionState } from "react";
import { addLinksManually, importDlc, type AddLinksState } from "./actions";

export function AddLinksForm({ containerId }: { containerId: number }) {
  const [state, action, pending] = useActionState<AddLinksState, FormData>(addLinksManually, {});
  return (
    <form action={action} className="space-y-3 p-4">
      <input type="hidden" name="id" value={containerId} />
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
        {state.message && <span className="text-sm text-emerald-500">{state.message}</span>}
        {state.error && <span className="text-sm text-red-500">{state.error}</span>}
      </div>
    </form>
  );
}

export function ImportDlcForm({ containerId }: { containerId: number }) {
  const [state, action, pending] = useActionState<AddLinksState, FormData>(importDlc, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3 border-t border-border p-4">
      <input type="hidden" name="id" value={containerId} />
      <span className="text-sm font-medium">Import a .dlc file</span>
      <input type="file" name="dlc" accept=".dlc,application/octet-stream,text/plain" className="text-sm" required />
      <button className="btn" disabled={pending}>
        {pending ? "Importing…" : "Import"}
      </button>
      {state.message && <span className="text-sm text-emerald-500">{state.message}</span>}
      {state.error && <span className="text-sm text-red-500">{state.error}</span>}
      <p className="w-full text-xs text-muted">Decrypting uses JDownloader&apos;s DLC service, so Riparr needs internet access to it.</p>
    </form>
  );
}
