"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { ACCOUNT_FIELDS, listHostAccounts, saveHostAccount } from "@/lib/host-accounts";
import { normalizeTargetDir } from "@/lib/paths";
import { saveSettings } from "@/lib/settings";

// TODO(phase 4): verify auth in every action once Riparr has a login.

export type SettingsState = { errors?: Record<string, string[] | undefined>; saved?: boolean };

const settingsInput = z.object({
  concurrency: z.coerce.number<string>().int().min(1).max(20),
  perHost: z.coerce.number<string>().int().min(1).max(10),
  mbPerSecond: z.coerce.number<string>().min(0, "Use 0 for unlimited").max(10_000),
  cnlEnabled: z.preprocess((v) => v === "on", z.boolean()),
  cnlTargetDir: z.string().transform((v, ctx) => {
    const dir = normalizeTargetDir(v);
    if (dir === null) {
      ctx.addIssue({ code: "custom", message: "Must be a relative path inside the downloads folder" });
      return z.NEVER;
    }
    return dir;
  }),
  cnlTemplate: z
    .string()
    .trim()
    .refine((v) => v.includes("{filename}") || v.includes("{name}"), "Template must include {filename} or {name}"),
});

export async function saveAppSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const parsed = settingsInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const { mbPerSecond, ...rest } = parsed.data;
  saveSettings({ ...rest, bytesPerSecond: Math.round(mbPerSecond * 1024 * 1024) });
  refresh();
  return { saved: true };
}

export async function saveAccount(formData: FormData) {
  const host = String(formData.get("host"));
  const spec = ACCOUNT_FIELDS[host];
  if (!spec) throw new Error("Unknown host");

  const current = listHostAccounts()[host] ?? {};
  const next: Record<string, string> = {};
  for (const field of spec.fields) {
    const value = String(formData.get(field.key) ?? "").trim();
    if (formData.get(`clear_${field.key}`) === "on") continue;
    // Secrets are never rendered back, so an empty secret input means "keep".
    next[field.key] = value || (field.secret ? (current[field.key] ?? "") : "");
  }
  saveHostAccount(host, next);
  refresh();
}
