"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Check, CircleAlert, CircleCheck, Loader, PlugZap, type LucideIcon } from "lucide-react";
import type { SettingsState, TestState } from "../actions";

type SettingsAction = (prev: SettingsState, formData: FormData) => Promise<SettingsState>;

/**
 * A settings page's form state, plus helpers that prefer the submitted values
 * (after a failed save) over the saved ones.
 */
export function useSettingsForm(action: SettingsAction) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(action, {});
  const v = state.values;
  return {
    state,
    formAction,
    pending,
    errors: state.errors ?? {},
    text: (name: string, saved: string | number | null | undefined) => v?.[name]?.[0] ?? (saved == null ? "" : String(saved)),
    checked: (name: string, saved: boolean) => (v ? v[name]?.[0] === "on" : saved),
    list: (name: string, saved: readonly string[]) => v?.[name] ?? saved,
  };
}

/** Discard + Save for the page header; buttons point at the page's form by id. */
export function SaveActions({ formId, pending, state }: { formId: string; pending: boolean; state: SettingsState }) {
  const hasErrors = Boolean(state.errors && Object.values(state.errors).some((e) => e?.length));
  return (
    <>
      {hasErrors && !pending && (
        <span className="inline-flex items-center gap-1 text-sm text-critical" role="alert">
          <CircleAlert size={15} strokeWidth={2} aria-hidden="true" />
          Not saved; check the fields below
        </span>
      )}
      <button type="reset" form={formId} className="btn btn-ghost" disabled={pending}>
        Discard
      </button>
      <button type="submit" form={formId} className="btn btn-primary" disabled={pending}>
        {pending ? <Loader size={15} className="animate-spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
        {pending ? "Saving…" : "Save changes"}
      </button>
      <SavedToast savedAt={state.savedAt} />
    </>
  );
}

/** Ink pill at the bottom centre for about 3 seconds after a save. */
export function SavedToast({ savedAt, message = "Settings saved" }: { savedAt?: number; message?: string }) {
  const [hiddenFor, setHiddenFor] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setHiddenFor(savedAt), 3000);
    return () => clearTimeout(t);
  }, [savedAt]);
  const visible = Boolean(savedAt) && hiddenFor !== savedAt;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
      {visible && (
        <span className="inline-flex items-center gap-2 rounded-pill bg-primary px-4 py-2 text-sm font-medium text-primary-fg shadow-lg">
          <CircleCheck size={15} aria-hidden="true" />
          {message}
        </span>
      )}
    </div>
  );
}

/**
 * A Test button that runs a server check against the saved settings and shows the
 * result inline. It's a plain button (not a form), so it can sit inside a settings form.
 */
export function TestButton({
  run,
  label = "Test",
  icon: Icon = PlugZap,
}: {
  run: () => Promise<TestState>;
  label?: string;
  icon?: LucideIcon;
}) {
  const [state, action, pending] = useActionState<TestState>(run, {});
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" className="btn" disabled={pending} onClick={() => startTransition(() => action())}>
        {pending ? <Loader size={15} className="animate-spin" aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
        {pending ? "Testing…" : label}
      </button>
      {state.result && !pending && (
        <span role="status" className={`inline-flex min-w-0 items-center gap-1 text-sm ${state.ok ? "text-good" : "text-critical"}`}>
          {state.ok ? <CircleCheck size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
          <span className="min-w-0 break-words">{state.result}</span>
        </span>
      )}
    </div>
  );
}
