import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { apiKey, authMode, currentUsername } from "@/lib/auth";
import { ACCOUNT_FIELDS, listHostAccounts } from "@/lib/host-accounts";
import { getSettings } from "@/lib/settings";
import { logout } from "../auth-actions";
import { newApiKey, saveAccount, setAuthentication } from "./actions";
import { PasswordForm } from "./security";
import { IntegrationTests, SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <Settings />
      </Suspense>
    </div>
  );
}

async function Settings() {
  await connection();
  const accounts = listHostAccounts();
  const mode = authMode();
  const username = currentUsername();
  const envOverride = process.env.RIPARR_AUTH === "none";
  return (
    <>
      <SettingsForm settings={getSettings()} />
      <IntegrationTests />

      <section className="card space-y-5 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Security</h2>
          {mode === "forms" && (
            <form action={logout}>
              <button className="btn">Log out</button>
            </form>
          )}
        </div>

        <form action={setAuthentication} className="space-y-2">
          <p className="text-sm">
            Authentication is <strong>{mode === "forms" ? "required" : "disabled"}</strong>
            {envOverride && " (forced off by RIPARR_AUTH=none)"}.
          </p>
          {!envOverride && (
            <>
              <input type="hidden" name="mode" value={mode === "forms" ? "none" : "forms"} />
              <button className="btn" disabled={mode === "none" && !username}>
                {mode === "forms" ? "Disable authentication" : "Require login"}
              </button>
              {mode === "forms" && (
                <p className="text-xs text-muted">Only disable this if Riparr is behind another login, such as a reverse proxy with auth.</p>
              )}
              {mode === "none" && !username && <p className="text-xs text-muted">Set a login below first.</p>}
            </>
          )}
        </form>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Login</h3>
          <PasswordForm username={username ?? ""} requireCurrent={mode === "forms" && Boolean(username)} />
        </div>

        <form action={newApiKey} className="space-y-2">
          <h3 className="text-sm font-medium">API key</h3>
          <p className="text-xs text-muted">
            For scripts and dashboard widgets: send it as an <code>X-Api-Key</code> header or <code>?apikey=</code> to{" "}
            <code>/api/v1</code>.
          </p>
          <div className="flex gap-2">
            <input readOnly className="input font-mono" value={apiKey()} />
            <button className="btn shrink-0">Regenerate</button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Host accounts</h2>
        {Object.entries(ACCOUNT_FIELDS).map(([host, spec]) => {
          const saved = accounts[host] ?? {};
          return (
            <form key={host} action={saveAccount} className="card space-y-4 p-5">
              <input type="hidden" name="host" value={host} />
              <h3 className="font-medium">{spec.label}</h3>
              {spec.fields.map((f) => {
                const isSet = Boolean(saved[f.key]);
                return (
                  <div key={f.key} className="space-y-1">
                    <label className="block space-y-1">
                      <span className="text-sm font-medium">{f.label}</span>
                      <input
                        name={f.key}
                        className="input font-mono"
                        autoComplete="off"
                        type={f.secret ? "password" : "text"}
                        placeholder={f.secret && isSet ? "•••••••• (saved, leave empty to keep)" : ""}
                        defaultValue={f.secret ? "" : (saved[f.key] ?? "")}
                      />
                    </label>
                    <div className="flex items-center gap-3 text-xs text-muted">
                      {f.hint && <span>{f.hint}</span>}
                      {isSet && (
                        <label className="ml-auto flex items-center gap-1">
                          <input type="checkbox" name={`clear_${f.key}`} /> Clear
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
              <button className="btn">Save {spec.label}</button>
            </form>
          );
        })}
        <p className="text-xs text-muted">
          MEGA works with public links only; account login isn&apos;t supported yet. Credentials are stored unencrypted
          in the Riparr database under /config.
        </p>
      </section>
    </>
  );
}
