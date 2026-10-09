"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  authMode,
  checkCredentials,
  currentUsername,
  regenerateApiKey,
  setAuthMode,
  setCredentials,
} from "@/lib/auth";
import { credentialsInput } from "@/lib/credentials";
import { requireSession, startSession } from "@/lib/session";
import { ACCOUNT_FIELDS, listHostAccounts, saveHostAccount } from "@/lib/host-accounts";
import { normalizeTargetDir } from "@/lib/paths";
import { testFlareSolverr } from "@/lib/crawlers";
import { notify } from "@/lib/notify";
import { KNOWN_HOSTS } from "@/lib/host-ids";
import { getSettings, NOTIFY_EVENTS, saveSettings, type NotifyEvent } from "@/lib/settings";

export type SettingsState = { errors?: Record<string, string[] | undefined>; saved?: boolean };

const optionalUrl = z
  .string()
  .trim()
  .refine((v) => v === "" || /^https?:\/\/[^\s]+$/.test(v), "Must be an http(s) URL")
  .transform((v) => v.replace(/\/+$/, ""));

const settingsInput = z.object({
  concurrency: z.coerce.number<string>().int().min(1).max(20),
  perHost: z.coerce.number<string>().int().min(1).max(10),
  mbPerSecond: z.coerce.number<string>().min(0, "Use 0 for unlimited").max(10_000),
  minFreeGb: z.coerce.number<string>().min(0, "Use 0 to turn off").max(100_000),
  cnlEnabled: z.preprocess((v) => v === "on", z.boolean()),
  extractEnabled: z.preprocess((v) => v === "on", z.boolean()),
  extractDeleteArchives: z.preprocess((v) => v === "on", z.boolean()),
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
  flaresolverrUrl: optionalUrl,
  notifyWebhookUrl: optionalUrl,
  notifyAppriseUrl: optionalUrl,
});

export async function saveAppSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireSession();
  const parsed = settingsInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const { mbPerSecond, ...rest } = parsed.data;
  const notifyEvents = formData.getAll("notifyEvents").filter((e): e is NotifyEvent => String(e) in NOTIFY_EVENTS);
  const known: string[] = KNOWN_HOSTS.map((h) => h.id);
  const picked = [...new Set(formData.getAll("hostPriority").map(String))].filter((id) => known.includes(id));
  const hostPriority = [...picked, ...known.filter((id) => !picked.includes(id))];
  saveSettings({ ...rest, notifyEvents, hostPriority, bytesPerSecond: Math.round(mbPerSecond * 1024 * 1024) });
  refresh();
  return { saved: true };
}

export async function saveAccount(formData: FormData) {
  await requireSession();
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

export type SecurityState = { errors?: Record<string, string[] | undefined>; message?: string };

export async function changePassword(_prev: SecurityState, formData: FormData): Promise<SecurityState> {
  const user = await requireSession();
  const current = String(formData.get("current") ?? "");
  // With auth disabled there's no current session to vouch for the user.
  if (authMode() === "forms" && !checkCredentials(currentUsername() ?? user, current)) {
    return { errors: { current: ["Current password is wrong"] } };
  }
  const parsed = credentialsInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  setCredentials(parsed.data.username, parsed.data.password);
  // Every session was just invalidated, including this one; start a fresh one.
  await startSession(parsed.data.username);
  return { message: "Password changed. Other sessions were signed out." };
}

export async function setAuthentication(formData: FormData) {
  await requireSession();
  const mode = formData.get("mode") === "none" ? "none" : "forms";
  if (mode === "forms" && !currentUsername()) throw new Error("Create a login before enabling authentication");
  setAuthMode(mode);
  refresh();
}

export async function newApiKey() {
  await requireSession();
  regenerateApiKey();
  refresh();
}

export type TestState = { result?: string; ok?: boolean };

export async function sendTestNotification(): Promise<TestState> {
  await requireSession();
  const errors = await notify({ event: "test", message: "Notifications from Riparr are working." });
  return errors.length ? { ok: false, result: errors.join("; ") } : { ok: true, result: "Sent" };
}

export async function checkFlareSolverr(): Promise<TestState> {
  await requireSession();
  const url = getSettings().flaresolverrUrl;
  if (!url) return { ok: false, result: "No FlareSolverr URL saved" };
  const result = await testFlareSolverr(url);
  return result.ok ? { ok: true, result: `Connected (FlareSolverr ${result.version})` } : { ok: false, result: result.error };
}
