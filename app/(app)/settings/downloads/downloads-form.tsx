"use client";

import { Field, PageHeader, SwitchRow } from "../../_kit";
import { Section, SettingsCard } from "../_ui/section";
import { SaveActions, useSettingsForm } from "../_ui/form";
import { saveDownloadSettings } from "../actions";
import { HostPriority } from "./host-priority";

type DownloadSettings = {
  concurrency: number;
  perHost: number;
  mbPerSecond: number;
  minFreeGb: number;
  hostPriority: string[];
  extractEnabled: boolean;
  extractDeleteArchives: boolean;
};

const FORM_ID = "settings-downloads";

export function DownloadsForm({ settings }: { settings: DownloadSettings }) {
  const form = useSettingsForm(saveDownloadSettings);
  const { errors } = form;
  const hostOrder = form.list("hostPriority", settings.hostPriority);

  return (
    <>
      <PageHeader
        title="Downloads"
        subtitle="How many files download at once and which hosts Riparr prefers."
        actions={<SaveActions formId={FORM_ID} pending={form.pending} state={form.state} />}
      />
      <form id={FORM_ID} action={form.formAction}>
        <SettingsCard>
          <Section title="Limits" intro="Keep room for other traffic on your connection, and for other files on the disk.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Downloads at once" htmlFor="concurrency" hint="Across all hosts (1–20)." errors={errors.concurrency}>
                <input id="concurrency" name="concurrency" type="number" inputMode="numeric" min={1} max={20} className="input tabular-nums" defaultValue={form.text("concurrency", settings.concurrency)} />
              </Field>
              <Field label="Per host" htmlFor="perHost" hint="From any single host (1–10)." errors={errors.perHost}>
                <input id="perHost" name="perHost" type="number" inputMode="numeric" min={1} max={10} className="input tabular-nums" defaultValue={form.text("perHost", settings.perHost)} />
              </Field>
              <Field label="Speed limit per download (MB/s)" htmlFor="mbPerSecond" hint="0 means no limit." errors={errors.mbPerSecond}>
                <input id="mbPerSecond" name="mbPerSecond" type="number" inputMode="decimal" min={0} step="0.1" className="input tabular-nums" defaultValue={form.text("mbPerSecond", settings.mbPerSecond)} />
              </Field>
              <Field label="Keep free (GB)" htmlFor="minFreeGb" hint="New downloads wait while a root folder has less free space; 0 turns this off." errors={errors.minFreeGb}>
                <input id="minFreeGb" name="minFreeGb" type="number" inputMode="numeric" min={0} step="1" className="input tabular-nums" defaultValue={form.text("minFreeGb", settings.minFreeGb)} />
              </Field>
            </div>
          </Section>

          <Section
            title="Preferred hosts"
            intro="When a file is on several hosts, Riparr downloads it from the highest one here and keeps the others as fallbacks."
          >
            <HostPriority key={hostOrder.join(",")} initial={[...hostOrder]} />
          </Section>

          <Section title="Archives" intro="Archives are unpacked with 7-Zip once a title's links have all finished, trying the source's password.">
            <SwitchRow
              name="extractEnabled"
              label="Extract archives"
              hint="zip, rar and 7z, including split parts"
              defaultChecked={form.checked("extractEnabled", settings.extractEnabled)}
            />
            <SwitchRow
              name="extractDeleteArchives"
              label="Delete archives after extracting"
              hint="Only after a successful extraction"
              defaultChecked={form.checked("extractDeleteArchives", settings.extractDeleteArchives)}
            />
          </Section>
        </SettingsCard>
      </form>
    </>
  );
}
