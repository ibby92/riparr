import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { apiKey, authMode, currentUsername } from "@/lib/auth";
import { ACCOUNT_FIELDS, listHostAccounts } from "@/lib/host-accounts";
import { maskProxyUrl } from "@/lib/net";
import { getSettings } from "@/lib/settings";
import { logout } from "../auth-actions";
import { newApiKey, removeRootFolderAction, saveAccount, setAuthentication } from "./actions";
import { PasswordForm } from "./security";
import { AddRootFolderForm, IntegrationTests, SettingsForm } from "./settings-form";
import { formatBytes } from "../links-table";
import { listRootFolders } from "@/lib/root-folders";

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
  const settings = getSettings();
  const roots = listRootFolders();
  return (
    <>
      <section className="card space-y-4 p-5">
        <div>
          <h2 className="text-lg font-semibold">Root folders</h2>
          <p className="text-sm text-muted">
            Where your library lives, as paths inside Riparr&apos;s container (e.g. your NAS <code>Videos</code> share mounted at{" "}
            <code>/media</code>, with root folders <code>/media/Kdrama</code> and <code>/media/Movies</code>).
          </p>
        </div>
        {roots.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {roots.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <code className="min-w-0 flex-1 break-all">{r.path}</code>
                <span className="text-xs text-muted">
                  {r.accessible ? `${formatBytes(r.free_bytes)} free` : "not reachable"} · {r.title_count} title(s)
                </span>
                <form action={removeRootFolderAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="btn btn-danger" disabled={r.title_count > 0} title={r.title_count ? "Titles still use it" : undefined}>
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <AddRootFolderForm />
      </section>

      {/* Secrets (proxy password, TMDB key) never reach the browser. */}
      <SettingsForm
        settings={{ ...settings, proxyUrl: maskProxyUrl(settings.proxyUrl), tmdbApiKey: "" }}
        envProxy={Boolean(process.env.RIPARR_PROXY_URL)}
        roots={roots.map((r) => ({ id: r.id, path: r.path }))}
        tmdbKeySet={Boolean(settings.tmdbApiKey)}
      />
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
