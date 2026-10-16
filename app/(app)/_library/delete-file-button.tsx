"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteFile } from "../titles/actions";

/** Delete a file from the folder, with an inline confirm that can also queue the episode again. */
export function DeleteFileButton({ titleId, path, name }: { titleId: number; path: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className="btn btn-ghost btn-danger px-2" aria-label={`Delete ${name}`} onClick={() => setConfirming(true)}>
        <Trash2 size={16} aria-hidden="true" />
      </button>
    );
  }
  return (
    <form action={deleteFile} className="col-span-full flex flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-md bg-critical-soft px-3 py-2">
      <input type="hidden" name="id" value={titleId} />
      <input type="hidden" name="path" value={path} />
      <span className="text-xs text-critical">Delete this file from disk?</span>
      <label className="flex items-center gap-2 text-xs text-fg-2">
        <input type="checkbox" name="redownload" className="accent-accent" />
        Download it again
      </label>
      <button type="button" className="btn" onClick={() => setConfirming(false)}>
        Cancel
      </button>
      <button className="btn btn-primary">Delete</button>
    </form>
  );
}
