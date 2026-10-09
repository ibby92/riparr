"use client";

import { useActionState } from "react";
import { changePassword, type SecurityState } from "./actions";

function Errors({ errors }: { errors?: string[] }) {
  return errors?.map((e) => (
    <p key={e} className="text-xs text-red-500">
      {e}
    </p>
  ));
}

export function PasswordForm({ username, requireCurrent }: { username: string; requireCurrent: boolean }) {
  const [state, action, pending] = useActionState<SecurityState, FormData>(changePassword, {});
  const errors = state.errors ?? {};
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Username</span>
          <input name="username" className="input" defaultValue={username} autoComplete="username" required />
          <Errors errors={errors.username} />
        </label>
        {requireCurrent && (
          <label className="block space-y-1">
            <span className="text-sm font-medium">Current password</span>
            <input name="current" type="password" className="input" autoComplete="current-password" required />
            <Errors errors={errors.current} />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-sm font-medium">New password</span>
          <input name="password" type="password" className="input" autoComplete="new-password" minLength={8} required />
          <Errors errors={errors.password} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Confirm new password</span>
          <input name="confirm" type="password" className="input" autoComplete="new-password" required />
          <Errors errors={errors.confirm} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>
          {pending ? "Saving…" : requireCurrent ? "Change password" : "Set login"}
        </button>
        {state.message && <span className="text-sm text-emerald-500">{state.message}</span>}
      </div>
    </form>
  );
}
