"use client";

import { Send } from "lucide-react";
import { NOTIFY_EVENTS, type NotifyEvent } from "@/lib/notify-events";
import { Field, PageHeader } from "../../_kit";
import { Section, SettingsCard } from "../_ui/section";
import { SaveActions, TestButton, useSettingsForm } from "../_ui/form";
import { saveNotificationSettings, sendTestNotification } from "../actions";

type NotificationSettings = { notifyWebhookUrl: string; notifyAppriseUrl: string; notifyEvents: NotifyEvent[] };

const FORM_ID = "settings-notifications";

export function NotificationsForm({ settings }: { settings: NotificationSettings }) {
  const form = useSettingsForm(saveNotificationSettings);
  const { errors } = form;
  const events = form.list("notifyEvents", settings.notifyEvents);

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Get a message when something happens."
        actions={<SaveActions formId={FORM_ID} pending={form.pending} state={form.state} />}
      />
      <form id={FORM_ID} action={form.formAction}>
        <SettingsCard>
          <Section title="Where to send" intro="A webhook (Discord webhook URLs are detected and formatted), an Apprise API endpoint, or both.">
            <Field label="Webhook URL" htmlFor="notifyWebhookUrl" hint="Receives a JSON POST." errors={errors.notifyWebhookUrl}>
              <input
                id="notifyWebhookUrl"
                name="notifyWebhookUrl"
                className="input input-mono"
                defaultValue={form.text("notifyWebhookUrl", settings.notifyWebhookUrl)}
                placeholder="https://discord.com/api/webhooks/…"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Apprise API URL" htmlFor="notifyAppriseUrl" hint="e.g. http://apprise:8000/notify/riparr" errors={errors.notifyAppriseUrl}>
              <input
                id="notifyAppriseUrl"
                name="notifyAppriseUrl"
                className="input input-mono"
                defaultValue={form.text("notifyAppriseUrl", settings.notifyAppriseUrl)}
                placeholder="http://apprise:8000/notify/riparr"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <TestButton run={sendTestNotification} label="Send test" icon={Send} />
            <p className="-mt-2 text-xs text-muted">Sends to the saved URLs.</p>
          </Section>

          <Section title="Notify me when" intro="Pick the events worth a ping.">
            <div className="divide-y divide-border">
              {(Object.entries(NOTIFY_EVENTS) as [NotifyEvent, string][]).map(([key, label]) => (
                <NotifySwitch key={key} event={key} label={label} checked={events.includes(key)} />
              ))}
            </div>
          </Section>
        </SettingsCard>
      </form>
    </>
  );
}

/** A switch submitting `notifyEvents=<event>` when on. */
function NotifySwitch({ event, label, checked }: { event: NotifyEvent; label: string; checked: boolean }) {
  return (
    <div className="flex items-start gap-4 py-2">
      <label htmlFor={`notify-${event}`} className="min-w-0 flex-1 text-sm font-medium text-fg">
        {label}
      </label>
      <input
        id={`notify-${event}`}
        name="notifyEvents"
        value={event}
        type="checkbox"
        role="switch"
        defaultChecked={checked}
        className="relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-pill bg-border-strong transition-colors before:absolute before:left-0.5 before:top-0.5 before:size-4 before:rounded-full before:bg-surface before:shadow-xs before:transition-transform checked:bg-accent checked:before:translate-x-4"
      />
    </div>
  );
}
