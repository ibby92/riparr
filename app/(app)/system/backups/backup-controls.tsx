"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Archive, Loader, Trash2 } from "lucide-react";
import { SavedToast } from "../../settings/_ui/form";
import { backupNow, deleteBackup, type BackupState } from "../actions";
import { SubmitButton } from "../../_kit";

export function BackupNowButton() {
  const [state, action, pending] = useActionState<BackupState>(backupNow, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      {state.error && !pending && (
        <span role="alert" className="text-sm text-critical">
          {state.error}
        </span>
      )}
      <button className="btn btn-primary" disabled={pending}>
        {pending ? <Loader size={15} className="animate-spin" aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}
        {pending ? "Backing up…" : "Back up now"}
      </button>
      <SavedToast savedAt={state.message ? state.at : undefined} message={state.message} />
    </form>
  );
}

/** A backup row: its cells, then Delete, which turns the row red with Cancel / Delete. */
export function DeleteBackupButton({ name, children }: { name: string; children: ReactNode }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      className={`grid grid-cols-2 items-center gap-x-4 gap-y-1.5 px-4 py-3 md:grid-cols-[minmax(0,1fr)_130px_80px_90px_170px_auto] md:px-5 [&>*:first-child]:col-span-2 md:[&>*:first-child]:col-span-1 ${confirming ? "bg-critical-soft" : ""}`}
    >
      {children}
      <div className="col-span-2 flex flex-wrap items-center justify-end gap-2 md:col-span-1">
        {confirming ? (
          <form action={deleteBackup} className="flex flex-wrap items-center justify-end gap-2">
            <input type="hidden" name="name" value={name} />
            <span className="text-xs text-critical">Delete this backup?</span>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <SubmitButton className="btn btn-primary">Delete</SubmitButton>
          </form>
        ) : (
          <button type="button" className="btn btn-ghost btn-danger px-2" aria-label={`Delete ${name}`} onClick={() => setConfirming(true)}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
