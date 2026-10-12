"use client";

import { Field, PageHeader } from "../../_kit";
import { Section, SettingsCard } from "../_ui/section";
import { SaveActions, TestButton, useSettingsForm } from "../_ui/form";
import { checkFlareSolverr, checkProxy, checkTmdb, saveConnectionSettings } from "../actions";

type ConnectionSettings = {
  tmdbKeySet: boolean;
  tmdbLanguage: string;
  proxyUrl: string;
  proxyScope: "containers" | "all";
  flaresolverrUrl: string;
};

const FORM_ID = "settings-connections";

const SCOPES = [
  { value: "containers", label: "Container sites only", hint: "Downloads stay on your own connection, at full speed" },
  { value: "all", label: "Everything", hint: "Container sites and file hosts (MEGA excepted)" },
] as const;

export function ConnectionsForm({
  settings,
  envProxy,
  warnings,
}: {
  settings: ConnectionSettings;
  envProxy: boolean;
  /** Server-side warnings per field, e.g. 127.0.0.1 inside Docker. */
  warnings?: { proxyUrl: string | null; flaresolverrUrl: string | null };
}) {
  const form = useSettingsForm(saveConnectionSettings);
  const { errors } = form;
  const scope = form.text("proxyScope", settings.proxyScope);

  return (
    <>
      <PageHeader
        title="Connections"
        subtitle="Services Riparr talks to on your network and on the internet. Tests use the saved settings, so save first."
        actions={<SaveActions formId={FORM_ID} pending={form.pending} state={form.state} />}
      />
      <form id={FORM_ID} action={form.formAction}>
        <SettingsCard>
          <Section title="TMDB" intro="Search, posters and episode counts. Get a free API key at themoviedb.org → Settings → API.">
            <Field label="API key" htmlFor="tmdbApiKey" errors={errors.tmdbApiKey}>
              <input
                id="tmdbApiKey"
                name="tmdbApiKey"
                type="password"
                className="input input-mono"
                autoComplete="off"
                spellCheck={false}
                placeholder={settings.tmdbKeySet ? "•••••••• (saved; leave empty to keep)" : "Paste a v3 API key or v4 read token"}
              />
              {settings.tmdbKeySet && (
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" name="clearTmdbApiKey" className="accent-accent" />
                  Remove the saved key
                </label>
              )}
            </Field>
            <Field label="Metadata language" htmlFor="tmdbLanguage" hint="A language code such as en-US or ko-KR." errors={errors.tmdbLanguage}>
              <input id="tmdbLanguage" name="tmdbLanguage" className="input max-w-40" defaultValue={form.text("tmdbLanguage", settings.tmdbLanguage)} />
            </Field>
            <TestButton run={checkTmdb} />
          </Section>

          <Section title="Proxy / VPN" intro="Send traffic through a proxy such as gluetun, to reach container sites your network blocks or keep your home IP private.">
            <Field
              label="Proxy URL"
              htmlFor="proxyUrl"
              errors={errors.proxyUrl}
              hint={
                envProxy && !settings.proxyUrl
                  ? "Using RIPARR_PROXY_URL from the environment. Enter a URL here to override it."
                  : "HTTP or SOCKS5, e.g. http://gluetun:8888 or socks5://user:pass@host:1080. Leave empty to connect directly."
              }
            >
              <input
                id="proxyUrl"
                name="proxyUrl"
                className="input input-mono"
                defaultValue={form.text("proxyUrl", settings.proxyUrl)}
                placeholder="http://gluetun:8888"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            {warnings?.proxyUrl && <p className="-mt-2 text-xs text-warn">{warnings.proxyUrl}</p>}
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-1.5 text-[13px] font-medium text-fg-2">Use the proxy for</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {SCOPES.map((s) => (
                  <label
                    key={s.value}
                    className="flex cursor-pointer gap-2.5 rounded-sm border border-border-strong bg-surface p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                  >
                    <input type="radio" name="proxyScope" value={s.value} defaultChecked={scope === s.value} className="mt-0.5 accent-accent" />
                    <span>
                      <span className="block text-sm font-medium text-fg">{s.label}</span>
                      <span className="block text-xs text-muted">{s.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <TestButton run={checkProxy} />
          </Section>

          <Section title="FlareSolverr" intro="Gets past Cloudflare challenges on container pages. Run it next to Riparr.">
            <Field label="FlareSolverr URL" htmlFor="flaresolverrUrl" hint="e.g. http://flaresolverr:8191. Leave empty to turn it off." errors={errors.flaresolverrUrl}>
              <input
                id="flaresolverrUrl"
                name="flaresolverrUrl"
                className="input input-mono"
                defaultValue={form.text("flaresolverrUrl", settings.flaresolverrUrl)}
                placeholder="http://flaresolverr:8191"
                spellCheck={false}
              />
            </Field>
            {warnings?.flaresolverrUrl && <p className="-mt-2 text-xs text-warn">{warnings.flaresolverrUrl}</p>}
            <TestButton run={checkFlareSolverr} />
          </Section>
        </SettingsCard>
      </form>
    </>
  );
}
