"use client";

import { Field, PageHeader } from "../../_kit";
import { Section, SettingsCard } from "../_ui/section";
import { SaveActions, useSettingsForm } from "../_ui/form";
import { saveHostAccounts } from "../actions";

export type HostAccountView = {
  host: string;
  label: string;
  fields: { key: string; label: string; hint?: string; secret: boolean; isSet: boolean; value: string }[];
};

const INTROS: Record<string, string> = {
  pixeldrain: "Free use is capped per day. An API key raises the limit; when it runs out, Riparr waits and resumes on its own.",
  gofile: "Without a token Riparr uses a guest account. A premium token removes the speed cap.",
};

const FORM_ID = "settings-hosts";

export function HostsForm({ hosts }: { hosts: HostAccountView[] }) {
  const form = useSettingsForm(saveHostAccounts);

  return (
    <>
      <PageHeader
        title="Hosts"
        subtitle="Accounts for each file host."
        actions={<SaveActions formId={FORM_ID} pending={form.pending} state={form.state} />}
      />
      <form id={FORM_ID} action={form.formAction}>
        <SettingsCard>
          {hosts.map((h) => (
            <Section key={h.host} title={h.label} intro={INTROS[h.host]}>
              {h.fields.map((f) => {
                const name = `${h.host}.${f.key}`;
                return (
                  <Field key={f.key} label={f.label} htmlFor={name} hint={f.hint}>
                    <input
                      id={name}
                      name={name}
                      className="input input-mono"
                      autoComplete="off"
                      spellCheck={false}
                      type={f.secret ? "password" : "text"}
                      placeholder={f.secret && f.isSet ? "•••••••• (saved; leave empty to keep)" : ""}
                      defaultValue={f.secret ? "" : form.text(name, f.value)}
                    />
                    {f.isSet && (
                      <label className="flex items-center gap-2 text-xs text-muted">
                        <input type="checkbox" name={`clear.${name}`} className="accent-accent" />
                        Remove the saved {f.label.toLowerCase()}
                      </label>
                    )}
                  </Field>
                );
              })}
            </Section>
          ))}
          <Section title="MEGA" intro="Public links only; account sign-in isn't supported yet.">
            <p className="text-sm text-muted">Nothing to set up. MEGA links download without an account.</p>
          </Section>
        </SettingsCard>
      </form>
      <p className="mt-3 text-xs text-muted">Credentials are stored unencrypted in the Riparr database under /config.</p>
    </>
  );
}
