import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { LogOut, ShieldCheck, ShieldOff } from "lucide-react";
import { apiKey, authMode, currentUsername } from "@/lib/auth";
import { logout } from "@/app/auth-actions";
import { PageHeader } from "../../_kit";
import { Section, SettingsCard } from "../_ui/section";
import { setAuthentication } from "../actions";
import { ApiKeyField, PasswordForm } from "./security-forms";

export const metadata: Metadata = { title: "Security" };

export default function SecuritySettingsPage() {
  return (
    <>
      <PageHeader title="Security" subtitle="Who can open Riparr. Each section saves on its own." />
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <Security />
      </Suspense>
    </>
  );
}

async function Security() {
  await connection();
  const mode = authMode();
  const username = currentUsername();
  const envOverride = process.env.RIPARR_AUTH === "none";

  return (
    <SettingsCard>
      <Section title="Authentication" intro="Required for every page and the API unless Riparr sits behind another login.">
        <div className="flex items-start gap-3 rounded-sm border border-border bg-surface-2 px-3.5 py-3">
          {mode === "forms" ? (
            <ShieldCheck size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-good" aria-hidden="true" />
          ) : (
            <ShieldOff size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
          )}
          <p className="text-sm text-fg">
            Sign-in is <strong className="font-medium">{mode === "forms" ? "required" : "turned off"}</strong>
            {envOverride && <span className="text-muted"> (forced off by RIPARR_AUTH=none)</span>}.
            {mode === "none" && !envOverride && <span className="block text-xs text-muted">Anyone who can reach this page can use Riparr.</span>}
          </p>
        </div>
        {!envOverride && (
          <form action={setAuthentication} className="flex flex-col items-start gap-1.5">
            <input type="hidden" name="mode" value={mode === "forms" ? "none" : "forms"} />
            <button className={mode === "forms" ? "btn btn-danger" : "btn btn-primary"} disabled={mode === "none" && !username}>
              {mode === "forms" ? "Turn off sign-in" : "Require sign-in"}
            </button>
            {mode === "forms" && (
              <p className="text-xs text-muted">Only turn this off if Riparr is behind another login, such as a reverse proxy with auth.</p>
            )}
            {mode === "none" && !username && <p className="text-xs text-muted">Set a username and password below first.</p>}
          </form>
        )}
      </Section>

      <Section
        title={username ? "Change password" : "Login"}
        intro={username ? "Changing it signs out every other session." : "The username and password for the sign-in page."}
      >
        <PasswordForm username={username ?? ""} requireCurrent={mode === "forms" && Boolean(username)} />
      </Section>

      <Section
        title="API key"
        intro={
          <>
            For scripts, other *arr tools and dashboard widgets: send it as an <code className="font-mono">X-Api-Key</code> header or{" "}
            <code className="font-mono">?apikey=</code> to <code className="font-mono">/api/v1</code>.
          </>
        }
      >
        <ApiKeyField value={apiKey()} />
      </Section>

      {mode === "forms" && (
        <Section title="Session" intro={username ? `Signed in as ${username}.` : undefined}>
          <form action={logout}>
            <button className="btn">
              <LogOut size={15} aria-hidden="true" />
              Sign out
            </button>
          </form>
        </Section>
      )}
    </SettingsCard>
  );
}
