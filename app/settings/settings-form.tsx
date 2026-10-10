"use client";

import { useActionState } from "react";
import { HostPriority } from "./host-priority";
import { NOTIFY_EVENTS } from "@/lib/notify-events";
import type { AppSettings } from "@/lib/settings";
import { addRootFolderAction, checkFlareSolverr, checkProxy, checkTmdb, saveAppSettings, sendTestNotification, type RootFolderState, type SettingsState, type TestState } from "./actions";

function Field({ label, hint, errors, children }: { label: string; hint?: string; errors?: string[]; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {errors?.map((e) => (
        <p key={e} className="text-xs text-red-500">
          {e}
        </p>
      ))}
      {hint && !errors?.length && <p className="text-xs text-muted">{hint}</p>}
    </label>
  );
}

export function SettingsForm({
  settings,
  envProxy,
  roots,
  tmdbKeySet,
}: {
  settings: AppSettings;
  envProxy: boolean;
  roots: { id: number; path: string }[];
  tmdbKeySet: boolean;
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveAppSettings, {});
  const errors = state.errors ?? {};
  const mb = settings.bytesPerSecond / 1024 / 1024;

  return (
    <form action={action} className="card space-y-6 p-5">
      <fieldset className="space-y-4">
        <legend className="mb-2 font-medium">Downloads</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Simultaneous downloads" errors={errors.concurrency}>
            <input name="concurrency" type="number" min={1} max={20} className="input" defaultValue={settings.concurrency} />
          </Field>
          <Field label="Per host" errors={errors.perHost}>
            <input name="perHost" type="number" min={1} max={10} className="input" defaultValue={settings.perHost} />
          </Field>
          <Field label="Speed limit per download (MB/s)" hint="0 = unlimited" errors={errors.mbPerSecond}>
            <input name="mbPerSecond" type="number" min={0} step="0.1" className="input" defaultValue={Number(mb.toFixed(2))} />
          </Field>
          <Field label="Keep free (GB)" hint="New downloads wait below this; 0 = off" errors={errors.minFreeGb}>
            <input name="minFreeGb" type="number" min={0} step="1" className="input" defaultValue={settings.minFreeGb} />
          </Field>
        </div>
        <HostPriority key={settings.hostPriority.join(",")} initial={settings.hostPriority} />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 font-medium">Archives</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="extractEnabled" defaultChecked={settings.extractEnabled} />
          Extract zip/rar/7z archives (including multi-part) after download, trying the container&apos;s password
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="extractDeleteArchives" defaultChecked={settings.extractDeleteArchives} />
          Delete the archive files after a successful extraction
        </label>
      </fieldset>

      <fieldset id="media" className="space-y-4">
        <legend className="mb-2 font-medium">Media Management</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["defaultShowRootId", "defaultMovieRootId"] as const).map((key) => (
            <Field key={key} label={key === "defaultShowRootId" ? "Root folder for new shows" : "Root folder for new movies"}>
              <select name={key} className="input" defaultValue={settings[key] ?? ""}>
                <option value="">{roots.length ? "First root folder" : "Add a root folder below"}</option>
                {roots.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.path}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="defaultSeasonFolders" defaultChecked={settings.defaultSeasonFolders} />
          New shows use season folders (<code>Season 01/</code>)
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 font-medium">Metadata (TMDB)</legend>
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field
            label="TMDB API key"
            hint="Free from themoviedb.org → Settings → API. Used for search, posters and episode counts."
            errors={errors.tmdbApiKey}
          >
            <input
              name="tmdbApiKey"
              type="password"
              className="input font-mono"
              autoComplete="off"
              placeholder={tmdbKeySet ? "•••••••• (saved, leave empty to keep)" : ""}
            />
          </Field>
          <Field label="Language" errors={errors.tmdbLanguage}>
            <input name="tmdbLanguage" className="input" defaultValue={settings.tmdbLanguage} />
          </Field>
        </div>
        {tmdbKeySet && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" name="clearTmdbApiKey" /> Remove the saved key
          </label>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 font-medium">Click&apos;n&apos;Load</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="cnlEnabled" defaultChecked={settings.cnlEnabled} />
          Listen on port 9666 (restart Riparr to apply). Links from pages you don&apos;t track yet become a new show in the
          default show root folder.
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 font-medium">Integrations</legend>
        <Field
          label="Proxy"
          hint={
            envProxy && !settings.proxyUrl
              ? "Using RIPARR_PROXY_URL from the environment. Enter a URL here to override it."
              : "e.g. http://gluetun:8888 or socks5://user:pass@host:1080, to reach container sites your network blocks. Leave empty for direct."
          }
          errors={errors.proxyUrl}
        >
          <input name="proxyUrl" className="input font-mono" defaultValue={settings.proxyUrl} placeholder="http://gluetun:8888" autoComplete="off" />
        </Field>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="proxyScope" value="containers" defaultChecked={settings.proxyScope !== "all"} />
            Container sites only (downloads stay on your own connection)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="proxyScope" value="all" defaultChecked={settings.proxyScope === "all"} />
            Everything (MEGA excepted)
          </label>
        </div>
        <Field
          label="FlareSolverr URL"
          hint="e.g. http://flaresolverr:8191, for container pages behind a Cloudflare challenge. Leave empty to disable."
          errors={errors.flaresolverrUrl}
        >
          <input name="flaresolverrUrl" className="input" defaultValue={settings.flaresolverrUrl} placeholder="http://flaresolverr:8191" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Webhook URL" hint="Receives JSON; Discord webhook URLs are detected" errors={errors.notifyWebhookUrl}>
            <input name="notifyWebhookUrl" className="input" defaultValue={settings.notifyWebhookUrl} />
          </Field>
          <Field label="Apprise API URL" hint="e.g. http://apprise:8000/notify/riparr" errors={errors.notifyAppriseUrl}>
            <input name="notifyAppriseUrl" className="input" defaultValue={settings.notifyAppriseUrl} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {Object.entries(NOTIFY_EVENTS).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" name="notifyEvents" value={key} defaultChecked={settings.notifyEvents.includes(key as never)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        {state.saved && !pending && <span className="text-sm text-emerald-500">Saved</span>}
      </div>
    </form>
  );
}

function TestButton({ label, run }: { label: string; run: () => Promise<TestState> }) {
  const [state, action, pending] = useActionState<TestState>(run, {});
  return (
    <form action={action} className="flex items-center gap-3">
      <button className="btn" disabled={pending}>
        {pending ? "Testing…" : label}
      </button>
      {state.result && <span className={`text-sm ${state.ok ? "text-emerald-500" : "text-red-500"}`}>{state.result}</span>}
    </form>
  );
}

/** Both tests use the saved settings. */
export function IntegrationTests() {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <TestButton label="Send test notification" run={sendTestNotification} />
      <TestButton label="Test FlareSolverr" run={checkFlareSolverr} />
      <TestButton label="Test proxy" run={checkProxy} />
      <TestButton label="Test TMDB" run={checkTmdb} />
      <span className="text-xs text-muted">Tests use saved settings.</span>
    </div>
  );
}

export function AddRootFolderForm() {
  const [state, action, pending] = useActionState<RootFolderState, FormData>(addRootFolderAction, {});
  return (
    <form action={action} className="flex flex-wrap items-start gap-2">
      <input name="path" className="input max-w-md flex-1 font-mono" placeholder="/media/Kdrama" required aria-label="Folder path" />
      <button className="btn" disabled={pending}>
        {pending ? "Adding…" : "Add root folder"}
      </button>
      {state.error && <p className="w-full text-sm text-red-500">{state.error}</p>}
      {state.message && <p className="w-full text-sm text-emerald-500">{state.message}</p>}
    </form>
  );
}
