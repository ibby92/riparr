"use client";

import { useActionState } from "react";
import { login, setup, type AuthFormState } from "../auth-actions";

function Errors({ errors }: { errors?: string[] }) {
  return errors?.map((e) => (
    <p key={e} className="text-xs text-red-500">
      {e}
    </p>
  ));
}

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(login, {});
  return (
    <form action={action} className="card space-y-4 p-5">
      <input type="hidden" name="next" value={next} />
      <label className="block space-y-1">
        <span className="text-sm font-medium">Username</span>
        <input name="username" className="input" autoComplete="username" defaultValue={state.username} required autoFocus />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Password</span>
        <input name="password" type="password" className="input" autoComplete="current-password" required />
      </label>
      {state.error && <p className="text-sm text-red-500">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(setup, {});
  const errors = state.errors ?? {};
  return (
    <form action={action} className="card space-y-4 p-5">
      <label className="block space-y-1">
        <span className="text-sm font-medium">Username</span>
        <input name="username" className="input" autoComplete="username" defaultValue={state.username} required autoFocus />
        <Errors errors={errors.username} />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Password</span>
        <input name="password" type="password" className="input" autoComplete="new-password" required minLength={8} />
        <Errors errors={errors.password} />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Confirm password</span>
        <input name="confirm" type="password" className="input" autoComplete="new-password" required />
        <Errors errors={errors.confirm} />
      </label>
      <button className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
