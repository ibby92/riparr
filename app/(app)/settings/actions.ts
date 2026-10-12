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
import { testFlareSolverr } from "@/lib/crawlers";
import { maskProxyUrl, proxiedFetch, proxyUrlError, proxyUrlSetting, publicIp, unmaskProxyUrl } from "@/lib/net";
import { notify } from "@/lib/notify";
import { addRootFolder, getRootFolder, normalizeRootPath, removeRootFolder, rootFolderError } from "@/lib/root-folders";
import { clearTmdbCache, createTmdbClient } from "@/lib/tmdb";
import { KNOWN_HOSTS } from "@/lib/host-ids";
import { getSettings, NOTIFY_EVENTS, saveSettings, type AppSettings, type NotifyEvent } from "@/lib/settings";
import { logEvent } from "@/lib/events";

/**
 * State of a settings page's form. Each page has its own action that parses only
 * its own fields, so saving one page never touches another page's settings.
 * `values` echoes what was submitted after a failed save (secrets left out);
 * `savedAt` drives the "Saved" confirmation.
 */
export type SettingsState = {
  errors?: Record<string, string[] | undefined>;
  values?: Record<string, string[]>;
  savedAt?: number;
};

/** Submitted fields as lists (checkbox groups repeat a name), minus secrets and React's internals. */
function formValues(formData: FormData, omit: string[] = []): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith("$ACTION") || omit.includes(key)) continue;
    out[key] = formData.getAll(key).map(String);
  }
  return out;
}

/** Single-valued fields as an object for zod (checkboxes come through as "on"). */
function fields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData) if (typeof value === "string") out[key] = value;
  return out;
}

function failed(error: z.ZodError, values: Record<string, string[]>): SettingsState {
  return { errors: z.flattenError(error).fieldErrors as Record<string, string[] | undefined>, values };
}

function saved(): SettingsState {
  refresh();
  return { savedAt: Date.now() };
}

const checkbox = z.preprocess((v) => v === "on", z.boolean());

const optionalUrl = z
  .string()
  .trim()
  .refine((v) => v === "" || /^https?:\/\/[^\s]+$/.test(v), "Must be an http(s) URL")
  .transform((v) => v.replace(/\/+$/, ""));

const optionalId = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : v),
  z.coerce.number<string>().int().positive().nullable(),
);

/* ------------------------------------------------------------ media */

const mediaInput = z.object({
  defaultShowRootId: optionalId,
  defaultMovieRootId: optionalId,
  defaultSeasonFolders: checkbox,
  cnlEnabled: checkbox,
});

/** Settings whose values are never written to the log (only that they changed): keys and URLs that can carry credentials. */
const SECRET_SETTINGS = new Set<string>(["tmdbApiKey", "proxyUrl", "notifyWebhookUrl", "notifyAppriseUrl"]);

function show(v: unknown) {
  return Array.isArray(v) ? v.join(" > ") : typeof v === "string" ? `"${v}"` : String(v);
}

/** Saves settings and logs what changed (old → new), with secret values left out. */
function saveLogged(section: string, changes: Partial<AppSettings>) {
  const before = getSettings() as unknown as Record<string, unknown>;
  saveSettings(changes);
  const diffs = Object.entries(changes)
    .filter(([k, v]) => v !== undefined && JSON.stringify(before[k]) !== JSON.stringify(v))
    .map(([k, v]) => (SECRET_SETTINGS.has(k) ? `${k} changed` : `${k} ${show(before[k])} → ${show(v)}`));
  if (diffs.length) logEvent("info", `${section} settings saved: ${diffs.join(", ")}`, null, "web", { kind: "settings_changed", data: { section, changes: diffs } });
}

export async function saveMediaSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireSession();
  const values = formValues(formData);
  const parsed = mediaInput.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error, values);
  saveLogged("Media Management", parsed.data);
  return saved();
}

export type RootFolderState = { error?: string; message?: string; path?: string };

export async function addRootFolderAction(_prev: RootFolderState, formData: FormData): Promise<RootFolderState> {
  await requireSession();
  const raw = String(formData.get("path") ?? "").trim();
  if (!raw) return { error: "Enter a folder path" };
  const p = normalizeRootPath(raw);
  const error = rootFolderError(p);
  if (error) return { error, path: raw };
  addRootFolder(p);
  logEvent("info", `Root folder added: ${p}`, null, "web", { kind: "root_folder_added", data: { path: p } });
  refresh();
  return { message: `Added ${p}` };
}

export async function removeRootFolderAction(formData: FormData) {
  await requireSession();
  const id = Number(formData.get("id"));
  const root = getRootFolder(id);
  if (removeRootFolder(id) && root) logEvent("info", `Root folder removed: ${root.path}`, null, "web", { kind: "root_folder_removed", data: { path: root.path } });
  refresh();
}

/* ------------------------------------------------------------ downloads */

const downloadsInput = z.object({
  concurrency: z.coerce.number<string>().int().min(1).max(20),
  perHost: z.coerce.number<string>().int().min(1).max(10),
  mbPerSecond: z.coerce.number<string>().min(0, "Use 0 for unlimited").max(10_000),
  minFreeGb: z.coerce.number<string>().min(0, "Use 0 to turn off").max(100_000),
  extractEnabled: checkbox,
  extractDeleteArchives: checkbox,
});

export async function saveDownloadSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireSession();
  const values = formValues(formData);
  const parsed = downloadsInput.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error, values);
  const { mbPerSecond, ...rest } = parsed.data;
  const known: string[] = KNOWN_HOSTS.map((h) => h.id);
  const picked = [...new Set(formData.getAll("hostPriority").map(String))].filter((id) => known.includes(id));
  const hostPriority = [...picked, ...known.filter((id) => !picked.includes(id))];
  saveLogged("Downloads", { ...rest, hostPriority, bytesPerSecond: Math.round(mbPerSecond * 1024 * 1024) });
  return saved();
}

/* ------------------------------------------------------------ hosts */

/** Inputs are named `<host>.<field>`; `clear.<host>.<field>` removes a saved value. */
export async function saveHostAccounts(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireSession();
  const accounts = listHostAccounts();
  for (const [host, spec] of Object.entries(ACCOUNT_FIELDS)) {
    const current = accounts[host] ?? {};
    const next: Record<string, string> = {};
    for (const field of spec.fields) {
      const name = `${host}.${field.key}`;
      if (formData.get(`clear.${name}`) === "on") continue;
      const value = String(formData.get(name) ?? "").trim();
      // Secrets are never rendered back, so an empty secret input means "keep".
      next[field.key] = value || (field.secret ? (current[field.key] ?? "") : "");
    }
    const changed = Object.keys(next).filter((k) => (current[k] ?? "") !== next[k]);
    saveHostAccount(host, next);
    if (changed.length) {
      logEvent("info", `Host account for ${host} updated (${changed.join(", ")})`, null, "web", {
        kind: "settings_changed",
        data: { section: "Hosts", changes: [`${host} account (${changed.join(", ")}) changed`] },
      });
    }
  }
  return saved();
}

/* ------------------------------------------------------------ connections */

const connectionsInput = z.object({
  // Secret: the form never shows it, so an empty field keeps the saved key.
  tmdbApiKey: z.string().trim().optional(),
  tmdbLanguage: z.string().trim().regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Use a language code like en-US").default("en-US"),
  flaresolverrUrl: optionalUrl,
  proxyUrl: z.string().trim().default(""),
  proxyScope: z.enum(["containers", "all"]).default("containers"),
});

export async function saveConnectionSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireSession();
  const values = formValues(formData, ["tmdbApiKey", "proxyUrl"]);
  // Echo the proxy URL with any password masked again.
  values.proxyUrl = [maskProxyUrl(String(formData.get("proxyUrl") ?? ""))];
  const parsed = connectionsInput.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error, values);
  const { tmdbApiKey, ...rest } = parsed.data;
  // The form shows the proxy password masked; keep the stored one unless it was retyped.
  rest.proxyUrl = unmaskProxyUrl(rest.proxyUrl, getSettings().proxyUrl);
  const proxyError = proxyUrlError(rest.proxyUrl);
  if (proxyError) return { errors: { proxyUrl: [proxyError] }, values };

  const clearKey = formData.get("clearTmdbApiKey") === "on";
  if (clearKey || tmdbApiKey) {
    saveLogged("Connections", { tmdbApiKey: clearKey ? "" : tmdbApiKey! });
    clearTmdbCache();
  }
  saveLogged("Connections", rest);
  return saved();
}

export type TestState = { result?: string; ok?: boolean };

export async function checkFlareSolverr(): Promise<TestState> {
  await requireSession();
  const url = getSettings().flaresolverrUrl;
  if (!url) return { ok: false, result: "No FlareSolverr URL saved" };
  const result = await testFlareSolverr(url);
  return result.ok ? { ok: true, result: `Connected (FlareSolverr ${result.version})` } : { ok: false, result: result.error };
}

export async function checkProxy(): Promise<TestState> {
  await requireSession();
  const url = proxyUrlSetting();
  if (!url) return { ok: false, result: "No proxy saved" };
  try {
    const [direct, viaProxy] = await Promise.all([publicIp(fetch).catch(() => "unknown"), publicIp(proxiedFetch(url))]);
    if (direct === viaProxy) {
      return { ok: false, result: `Proxy works but your IP is unchanged (${viaProxy}); traffic isn't leaving through a VPN` };
    }
    return { ok: true, result: `Working: exits as ${viaProxy} (direct: ${direct})` };
  } catch (err) {
    const message = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
    return { ok: false, result: `Proxy failed: ${message}` };
  }
}

export async function checkTmdb(): Promise<TestState> {
  await requireSession();
  const { tmdbApiKey, tmdbLanguage } = getSettings();
  if (!tmdbApiKey) return { ok: false, result: "No TMDB API key saved" };
  const result = await createTmdbClient({ apiKey: tmdbApiKey, language: tmdbLanguage }).testConnection();
  return result.ok ? { ok: true, result: "Connected to TMDB" } : { ok: false, result: result.error };
}

/* ------------------------------------------------------------ notifications */

const notificationsInput = z.object({
  notifyWebhookUrl: optionalUrl,
  notifyAppriseUrl: optionalUrl,
});

export async function saveNotificationSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireSession();
  const values = formValues(formData);
  const parsed = notificationsInput.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error, values);
  const notifyEvents = formData.getAll("notifyEvents").filter((e): e is NotifyEvent => String(e) in NOTIFY_EVENTS);
  saveLogged("Notifications", { ...parsed.data, notifyEvents });
  return saved();
}

export async function sendTestNotification(): Promise<TestState> {
  await requireSession();
  const errors = await notify({ event: "test", message: "Notifications from Riparr are working." });
  return errors.length ? { ok: false, result: errors.join("; ") } : { ok: true, result: "Sent" };
}

/* ------------------------------------------------------------ security */

export type SecurityState = { errors?: Record<string, string[] | undefined>; message?: string; username?: string; savedAt?: number };

export async function changePassword(_prev: SecurityState, formData: FormData): Promise<SecurityState> {
  const user = await requireSession();
  const username = String(formData.get("username") ?? "");
  const current = String(formData.get("current") ?? "");
  // With auth disabled there's no current session to vouch for the user.
  if (authMode() === "forms" && !checkCredentials(currentUsername() ?? user, current)) {
    return { errors: { current: ["Current password is wrong"] }, username };
  }
  const parsed = credentialsInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, username };
  setCredentials(parsed.data.username, parsed.data.password);
  logEvent("info", `Login changed for ${parsed.data.username}; other sessions signed out`, null, "auth");
  // Every session was just invalidated, including this one; start a fresh one.
  await startSession(parsed.data.username);
  refresh();
  return { message: "Password changed. Other sessions were signed out.", savedAt: Date.now() };
}

export async function setAuthentication(formData: FormData) {
  await requireSession();
  const mode = formData.get("mode") === "none" ? "none" : "forms";
  if (mode === "forms" && !currentUsername()) throw new Error("Create a login before enabling authentication");
  setAuthMode(mode);
  logEvent(mode === "none" ? "warn" : "info", mode === "none" ? "Authentication turned off" : "Authentication turned on", null, "auth");
  refresh();
}

export async function newApiKey() {
  await requireSession();
  regenerateApiKey();
  logEvent("info", "API key regenerated; the old one no longer works", null, "auth");
  refresh();
}
