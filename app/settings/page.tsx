import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ACCOUNT_FIELDS, listHostAccounts } from "@/lib/host-accounts";
import { getSettings } from "@/lib/settings";
import { saveAccount } from "./actions";
import { SettingsForm } from "./settings-form";

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
  return (
    <>
      <SettingsForm settings={getSettings()} />

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
