"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Eye, EyeOff, RotateCw } from "lucide-react";
import { Field } from "../../_kit";
import { SavedToast } from "../_ui/form";
import { changePassword, newApiKey, type SecurityState } from "../actions";

export function PasswordForm({ username, requireCurrent }: { username: string; requireCurrent: boolean }) {
  const [state, action, pending] = useActionState<SecurityState, FormData>(changePassword, {});
  const errors = state.errors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Username" htmlFor="sec-username" errors={errors.username}>
          <input id="sec-username" name="username" className="input" defaultValue={state.username ?? username} autoComplete="username" required />
        </Field>
        {requireCurrent && (
          <Field label="Current password" htmlFor="sec-current" errors={errors.current}>
            <input id="sec-current" name="current" type="password" className="input" autoComplete="current-password" required />
          </Field>
        )}
        <Field label="New password" htmlFor="sec-password" hint="At least 8 characters." errors={errors.password}>
          <input id="sec-password" name="password" type="password" className="input" autoComplete="new-password" minLength={8} required />
        </Field>
        <Field label="Confirm new password" htmlFor="sec-confirm" errors={errors.confirm}>
          <input id="sec-confirm" name="confirm" type="password" className="input" autoComplete="new-password" required />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : requireCurrent ? "Change password" : "Set login"}
        </button>
        {state.message && !pending && (
          <span role="status" className="text-sm text-good">
            {state.message}
          </span>
        )}
      </div>
      <SavedToast savedAt={state.savedAt} message="Password saved" />
    </form>
  );
}

/** Masked API key with Show, Copy and Regenerate (with an inline confirm). */
export function ApiKeyField({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShown(true);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="api-key" className="text-[13px] font-medium text-fg-2">
        API key
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="api-key"
          readOnly
          type={shown ? "text" : "password"}
          className="input input-mono min-w-0 flex-1 basis-56"
          value={value}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="btn px-2.5" aria-label={shown ? "Hide key" : "Show key"} aria-pressed={shown} onClick={() => setShown(!shown)}>
          {shown ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
        </button>
        <button type="button" className="btn" onClick={() => void copy()}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {confirming ? (
        <form
          action={async () => {
            await newApiKey();
            setConfirming(false);
          }}
          className="flex flex-wrap items-center gap-2 rounded-sm bg-critical-soft px-3 py-2"
        >
          <span className="flex-1 text-sm text-critical">Scripts using the current key stop working.</span>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button className="btn btn-primary">
            <RotateCw size={15} aria-hidden="true" />
            Regenerate
          </button>
        </form>
      ) : (
        <div>
          <button type="button" className="btn" onClick={() => setConfirming(true)}>
            <RotateCw size={15} aria-hidden="true" />
            Regenerate
          </button>
        </div>
      )}
    </div>
  );
}
