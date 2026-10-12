"use client";

import { useEffect, useState } from "react";
import { LocateFixed } from "lucide-react";
import { Field, PageHeader } from "../../_kit";
import { Section, SettingsCard } from "../_ui/section";
import { SaveActions, useSettingsForm } from "../_ui/form";
import { saveGeneralSettings } from "../actions";

const FORM_ID = "settings-general";

function preview(zone: string, now: number) {
  try {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: zone }).format(now);
  } catch {
    return "";
  }
}

export function GeneralForm({ timeZone, serverZone, zones }: { timeZone: string; serverZone: string; zones: string[] }) {
  const form = useSettingsForm(saveGeneralSettings);
  const [zone, setZone] = useState(form.text("timeZone", timeZone));
  const [browserZone, setBrowserZone] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // The browser's zone and clock are only known on the client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrowserZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const effective = zone || serverZone;

  return (
    <>
      <PageHeader title="General" subtitle="Settings that apply across Riparr." actions={<SaveActions formId={FORM_ID} pending={form.pending} state={form.state} />} />
      <form id={FORM_ID} action={form.formAction}>
        <SettingsCard>
          <Section
            title="Time zone"
            intro="Every time and day Riparr shows (History, Logs, the dashboard, host limits) and the {date} naming token use this zone."
          >
            <Field label="Time zone" htmlFor="timeZone" errors={form.errors.timeZone}>
              <select id="timeZone" name="timeZone" className="input" value={zone} onChange={(e) => setZone(e.target.value)}>
                <option value="">Container&apos;s time zone ({serverZone})</option>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {browserZone && browserZone !== zone && (
                <button type="button" className="btn" onClick={() => setZone(browserZone)}>
                  <LocateFixed size={15} strokeWidth={1.75} aria-hidden="true" />
                  Use this browser&apos;s zone ({browserZone.replaceAll("_", " ")})
                </button>
              )}
              {now !== null && (
                <span className="text-muted">
                  It&apos;s now <b className="font-medium tabular-nums text-fg">{preview(effective, now)}</b> in {effective.replaceAll("_", " ")}
                </span>
              )}
            </div>
            <p className="text-xs text-muted">
              The container&apos;s zone comes from its <code className="font-mono">TZ</code> variable. Times already recorded don&apos;t change; they&apos;re
              just shown in the new zone. Download counts per day follow the new zone from now on.
            </p>
          </Section>
        </SettingsCard>
      </form>
    </>
  );
}
