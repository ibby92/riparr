"use client";

import { useActionState, type ReactNode } from "react";
import { CircleAlert, Loader } from "lucide-react";
import { login, setup, type AuthFormState } from "@/app/auth-actions";

function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="card p-5 shadow-sm md:p-7">
      <h1 className="font-display text-2xl font-medium text-fg">{title}</h1>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function AuthField({ label, id, errors, children }: { label: string; id: string; errors?: string[]; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-fg-2">
        {label}
      </label>
      {children}
      {errors?.map((e) => (
        <p key={e} className="text-xs text-critical">
          {e}
        </p>
      ))}
    </div>
  );
}

function SubmitButton({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  return (
    <button className="btn btn-primary min-h-[42px] w-full" disabled={pending}>
      {pending && <Loader size={15} className="animate-spin" aria-hidden="true" />}
      {pending ? busy : idle}
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(login, {});
  return (
    <AuthCard title="Sign in" subtitle="Welcome back.">
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <AuthField label="Username" id="login-username">
          <input
            id="login-username"
            name="username"
            className="input"
            autoComplete="username"
            defaultValue={state.username}
            required
            autoFocus
          />
        </AuthField>
        <AuthField label="Password" id="login-password">
          <input id="login-password" name="password" type="password" className="input" autoComplete="current-password" required />
        </AuthField>
        {state.error && (
          <p role="alert" className="flex items-start gap-2 rounded-sm bg-critical-soft px-3 py-2 text-sm text-critical">
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {state.error}
          </p>
        )}
        <SubmitButton pending={pending} idle="Sign in" busy="Signing in…" />
      </form>
    </AuthCard>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(setup, {});
  const errors = state.errors ?? {};
  return (
    <AuthCard title="Welcome to Riparr" subtitle="Create the account you'll use to sign in. You can change it later in Settings → Security.">
      <form action={action} className="space-y-4">
        <AuthField label="Username" id="setup-username" errors={errors.username}>
          <input
            id="setup-username"
            name="username"
            className="input"
            autoComplete="username"
            defaultValue={state.username}
            required
            autoFocus
          />
        </AuthField>
        <AuthField label="Password" id="setup-password" errors={errors.password}>
          <input id="setup-password" name="password" type="password" className="input" autoComplete="new-password" required minLength={8} />
        </AuthField>
        <AuthField label="Confirm password" id="setup-confirm" errors={errors.confirm}>
          <input id="setup-confirm" name="confirm" type="password" className="input" autoComplete="new-password" required />
        </AuthField>
        {state.error && (
          <p role="alert" className="text-sm text-critical">
            {state.error}
          </p>
        )}
        <SubmitButton pending={pending} idle="Create account" busy="Creating…" />
      </form>
    </AuthCard>
  );
}
