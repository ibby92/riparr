"use client";

import { useActionState, useState } from "react";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { siteHint } from "@/lib/site-hints";
import { checkSourceNow, editSource, removeSource, toggleSource, type SourceFormState } from "../titles/actions";
import { SubmitButton } from "../_kit";

export type SourceEditable = {
  id: number;
  url: string;
  poll: boolean;
  enabled: boolean;
  poll_interval_min: number;
  /** Whether a password is saved (it's never sent to the browser). */
  hasPassword: boolean;
};

const small = "btn h-9 min-h-0 px-3 text-[13px]";

/**
 * A source's buttons (Check, Edit, Disable, Remove) and its edit form, which
 * opens inline. A source that needs attention offers "Replace URL", for pages
 * whose link expired or moved.
 */
export function SourceActions({
  source: s,
  canCheck,
  needsAttention,
  label,
}: {
  source: SourceEditable;
  canCheck: boolean;
  needsAttention: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(s.url);
  const [state, action, pending] = useActionState<SourceFormState, FormData>(async (prev, formData) => {
    const result = await editSource(prev, formData);
    // Close after a successful save; the page refreshes with the new values.
    if (result.message) setOpen(false);
    return result;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form action={checkSourceNow}>
          <input type="hidden" name="id" value={s.id} />
          <SubmitButton className={small} disabled={!canCheck}>
            <RefreshCw size={15} strokeWidth={1.75} aria-hidden="true" />
            Check
          </SubmitButton>
        </form>
        <button type="button" className={`${small} ${needsAttention && !open ? "btn-primary" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
          {needsAttention ? "Replace URL" : "Edit"}
        </button>
        <form action={toggleSource}>
          <input type="hidden" name="id" value={s.id} />
          <input type="hidden" name="enabled" value={s.enabled ? "0" : "1"} />
          <SubmitButton className={small}>{s.enabled ? "Disable" : "Enable"}</SubmitButton>
        </form>
        <form action={removeSource}>
          <input type="hidden" name="id" value={s.id} />
          <SubmitButton className={`${small} btn-danger`} aria-label={`Remove source ${label}`}>
            <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
            Remove
          </SubmitButton>
        </form>
        {state.message && !open && (
          <span className="text-[13px] text-good" aria-live="polite">
            {state.message}
          </span>
        )}
      </div>

      {open && (
        <form action={action} className="space-y-3 rounded-sm border border-border bg-surface-2 p-3 md:p-4">
          <input type="hidden" name="id" value={s.id} />
          <label className="block space-y-1.5">
            <span className="block text-[13px] font-medium text-fg-2">Source page</span>
            <input
              name="url"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="input input-mono"
              autoFocus={needsAttention}
              onFocus={(e) => needsAttention && e.currentTarget.select()}
            />
            {needsAttention && (
              <span className="block text-xs text-muted">Paste the page&apos;s current address. Links found so far and the title&apos;s history stay.</span>
            )}
            {siteHint(url) && <span className="block text-xs text-muted">{siteHint(url)}</span>}
          </label>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <label className="block space-y-1.5">
              <span className="block text-[13px] font-medium text-fg-2">Password</span>
              <input name="password" className="input" autoComplete="off" placeholder={s.hasPassword ? "Saved; leave empty to keep" : "Optional"} />
            </label>
            <label className="block space-y-1.5">
              <span className="block text-[13px] font-medium text-fg-2">Every (min)</span>
              <input name="poll_interval_min" type="number" min={5} max={10080} defaultValue={s.poll_interval_min} className="input tabular-nums" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="inline-flex min-h-9 items-center gap-2 text-sm text-fg-2">
              <input type="checkbox" name="poll" defaultChecked={s.poll} className="size-4 accent-[var(--accent)]" />
              Check the page for new links
            </label>
            {s.hasPassword && (
              <label className="inline-flex min-h-9 items-center gap-2 text-sm text-fg-2">
                <input type="checkbox" name="clear_password" className="size-4 accent-[var(--accent)]" />
                Remove the saved password
              </label>
            )}
            <span className="flex-1" />
            {state.error && (
              <span className="text-sm text-critical" aria-live="polite">
                {state.error}
              </span>
            )}
            <button type="button" className={`${small} btn-ghost`} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className={`${small} btn-primary`} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
