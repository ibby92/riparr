"use client";

import { useActionState } from "react";
import type { Container } from "@/lib/containers";
import { TEMPLATE_TOKENS } from "@/lib/paths";
import { saveContainer, type FormState } from "./actions";

type Props = {
  container?: Pick<
    Container,
    "id" | "name" | "url" | "password" | "poll_interval_min" | "enabled" | "poll" | "target_dir" | "path_template"
  >;
};

function Field({
  label,
  hint,
  errors,
  children,
}: {
  label: string;
  hint?: string;
  errors?: string[];
  children: React.ReactNode;
}) {
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

export function ContainerForm({ container }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveContainer, {});
  const errors = state.errors ?? {};
  // After a failed submit, prefer what the user typed over the saved values.
  const v = state.values;
  const initial = (key: string, saved: string | number | null | undefined) => v?.[key] ?? saved ?? "";

  return (
    <form action={action} className="card max-w-2xl space-y-4 p-5">
      {container && <input type="hidden" name="id" value={container.id} />}

      <Field label="Name" errors={errors.name}>
        <input name="name" className="input" defaultValue={initial("name", container?.name)} required />
      </Field>

      <Field
        label="Container URL"
        hint="A link-protector or paste page that lists host links (viewcrate, rentry, …)"
        errors={errors.url}
      >
        <input name="url" type="url" className="input" defaultValue={initial("url", container?.url)} required />
      </Field>

      <Field label="Password" hint="Optional: container or archive password" errors={errors.password}>
        <input name="password" className="input" defaultValue={initial("password", container?.password ?? "")} autoComplete="off" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Poll every (minutes)" errors={errors.poll_interval_min}>
          <input
            name="poll_interval_min"
            type="number"
            min={5}
            className="input"
            defaultValue={initial("poll_interval_min", container?.poll_interval_min ?? 60)}
            required
          />
        </Field>
        <Field
          label="Target directory"
          hint="Relative to the downloads folder"
          errors={errors.target_dir}
        >
          <input name="target_dir" className="input" defaultValue={initial("target_dir", container?.target_dir)} placeholder="tv/My Show" required />
        </Field>
      </div>

      <Field
        label="File naming template"
        hint={`"/" makes folders. Tokens: ${TEMPLATE_TOKENS.map((t) => t.token).join(" ")}`}
        errors={errors.path_template}
      >
        <input
          name="path_template"
          className="input font-mono"
          defaultValue={initial("path_template", container?.path_template ?? "{dir}/{filename}")}
          required
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={v ? v.enabled === "on" : container ? container.enabled === 1 : true} />
        Enabled: download new links from this container
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="poll" className="mt-1" defaultChecked={v ? v.poll === "on" : container ? container.poll === 1 : true} />
        <span>
          Poll the page for new links
          <span className="block text-xs text-muted">
            Turn off for captcha-protected pages: solve the captcha in your browser and send links with Click&apos;n&apos;Load instead.
          </span>
        </span>
      </label>

      {state.message && <p className="text-sm text-red-500">{state.message}</p>}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving…" : container ? "Save changes" : "Add container"}
      </button>
    </form>
  );
}
