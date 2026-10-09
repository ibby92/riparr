"use client";

import { useActionState } from "react";
import { addLinksManually, type AddLinksState } from "./actions";

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
