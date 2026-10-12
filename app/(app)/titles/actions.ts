"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { configDir, getDb } from "@/lib/db";
import { cachePoster, removePosters } from "@/lib/media-cover";
import { fetchFor } from "@/lib/net";
import { getSettings } from "@/lib/settings";
import { createTmdbClient } from "@/lib/tmdb";
import type { FormState } from "./_add/types";
import { sendCommand } from "@/lib/commands";
import { decryptDlc, dlcLinks } from "@/lib/crawlers";
import { logDebug, logEvent } from "@/lib/events";
import { addLinks, getLink, requeueLink, setLinkStatus } from "@/lib/links";
import { getRootFolder } from "@/lib/root-folders";
import {
  createSource,
  deleteSource,
  findSourceByUrl,
  getSource,
  setSourceEnabled,
  sourceInput,
  titlePasswords,
  updateSource,
  type SourceInput,
} from "@/lib/sources";
import {
  createTitle,
  defaultFolder,
  deleteTitle,
  findTitleByTmdb,
  getTitle,
  setTitleArchived,
  setTitleMonitored,
  titleInput,
  updateTitle,
  type TitleInput,
  type TitleType,
} from "@/lib/titles";

export type { FormState } from "./_add/types";

function parseId(value: FormDataEntryValue | null): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid id");
  return id;
}

function formValues(formData: FormData) {
  return Object.fromEntries([...formData].filter((e): e is [string, string] => typeof e[1] === "string"));
}

const SAFE_POSTER_PATH = /^\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i;

type TmdbMeta = { year: number | null; overview: string | null; poster_path: string | null; total_episodes: number | null };

/**
 * Fresh metadata for a TMDB match. Falls back to what the form carried (from the search result)
 * when TMDB can't be reached, so adding a title never fails just because TMDB is slow.
 */
async function tmdbMeta(type: TitleType, tmdbId: number, fallback: Record<string, string>): Promise<TmdbMeta> {
  const { tmdbApiKey, tmdbLanguage } = getSettings();
  try {
    if (!tmdbApiKey) throw new Error("no key");
    const tmdb = createTmdbClient({ apiKey: tmdbApiKey, language: tmdbLanguage, fetch: fetchFor("host") });
    const m = type === "show" ? await tmdb.show(tmdbId) : await tmdb.movie(tmdbId);
    return {
      year: m.year,
      overview: m.overview || null,
      poster_path: m.posterPath && SAFE_POSTER_PATH.test(m.posterPath) ? m.posterPath : null,
      total_episodes: m.type === "show" ? m.totalEpisodes || null : null,
    };
  } catch {
    const poster = fallback.poster_path?.trim() ?? "";
    return {
      year: Number(fallback.year) || null,
      overview: fallback.overview?.trim() || null,
      poster_path: SAFE_POSTER_PATH.test(poster) ? poster : null,
      total_episodes: null,
    };
  }
}

/** Downloads the poster after the response is sent; a failure only means the placeholder shows. */
function cachePosterLater(type: TitleType, tmdbId: number, posterPath: string | null, force = false) {
  if (!posterPath) return;
  after(async () => {
    await cachePoster({ tmdbId, type, posterPath }, { configDir: configDir(), fetch: fetchFor("host"), force })
      .then((r) => logDebug("tmdb", `Poster for ${type} ${tmdbId} cached at ${r?.path ?? "?"}`))
      .catch((err) => logEvent("warn", `Couldn't cache the poster for ${type} ${tmdbId}: ${err instanceof Error ? err.message : String(err)}`, null, "tmdb"));
  });
}

/** Parses the shared title options; returns field errors or the validated input (without TMDB metadata yet). */
function parseTitleOptions(values: Record<string, string>) {
  const type: TitleType = values.type === "movie" ? "movie" : "show";
  const year = Number(values.year) || null;
  const withFolder = {
    ...values,
    type,
    folder: values.folder?.trim() || (values.name?.trim() ? defaultFolder(values.name.trim(), type, year) : ""),
    naming: values.naming?.trim() || "{filename}",
    season_folders: type === "show" && values.season_folders === "on",
    monitored: values.monitored === "on",
    overview: null,
    poster_path: null,
    total_episodes: null,
  };
  const parsed = titleInput.safeParse(withFolder);
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined> };
  if (!getRootFolder(parsed.data.root_folder_id)) return { errors: { root_folder_id: ["Choose a root folder"] } };
  return { data: parsed.data };
}

type SourceRow = { key: string; input: SourceInput };

/** Reads the Add form's source rows (`source_url_<i>`…); empty rows are skipped. */
function parseSources(values: Record<string, string>) {
  const count = Math.min(Number(values.source_count) || 0, 20);
  const errors: Record<string, string[]> = {};
  const rows: SourceRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const url = values[`source_url_${i}`]?.trim();
    if (!url) continue;
    const s = sourceInput.safeParse({
      url,
      password: values[`source_password_${i}`],
      poll_interval_min: values[`source_interval_${i}`] || "60",
      poll: values[`source_poll_${i}`] === "on",
      enabled: true,
    });
    if (!s.success) {
      const f = z.flattenError(s.error).fieldErrors;
      errors[`source_url_${i}`] = [...(f.url ?? []), ...(f.poll_interval_min ?? [])];
      continue;
    }
    if (seen.has(s.data.url)) {
      errors[`source_url_${i}`] = ["This page is listed twice"];
      continue;
    }
    seen.add(s.data.url);
    const taken = findSourceByUrl(s.data.url);
    if (taken) {
      const owner = getTitle(taken.title_id);
      errors[`source_url_${i}`] = [`Already a source of ${owner ? `"${owner.name}"` : "another title"}`];
      continue;
    }
    rows.push({ key: String(i), input: s.data });
  }
  return { rows, errors };
}

/** Step 2 of Add title: creates the title and its sources, then starts the first check. */
export async function addTitle(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const values = formValues(formData);
  const opts = parseTitleOptions(values);
  const sources = parseSources(values);
  const errors = { ...(opts.errors ?? {}), ...sources.errors };
  if (!opts.data || Object.keys(errors).length) return { errors, values, message: "Check the highlighted fields." };

  const input: TitleInput = { ...opts.data };
  if (input.tmdb_id) {
    const existing = findTitleByTmdb(input.type, input.tmdb_id);
    if (existing) return { values, message: `"${existing.name}" is already in your library.` };
    const meta = await tmdbMeta(input.type, input.tmdb_id, values);
    Object.assign(input, { ...meta, year: input.year ?? meta.year });
  }

  const db = getDb();
  let id: number;
  db.exec("BEGIN IMMEDIATE");
  try {
    id = createTitle(input);
    for (const s of sources.rows) createSource(id, s.input);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return { values, message: `Couldn't add the title: ${err instanceof Error ? err.message : String(err)}` };
  }

  logEvent("info", `Added ${input.type} "${input.name}"`, id, "web", { kind: "title_added" });
  // Before the first check: episodes already in the folder count as on disk.
  sendCommand({ type: "scan_title", titleId: id });
  if (input.monitored && sources.rows.some((s) => s.input.poll)) sendCommand({ type: "check_title", titleId: id });
  if (input.tmdb_id) cachePosterLater(input.type, input.tmdb_id, input.poster_path);
  redirect(`/titles/${id}`);
}

/** Edit title: folder/naming/monitor options and the TMDB match. Sources are edited on the title page. */
export async function editTitle(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const id = parseId(formData.get("id"));
  const values = formValues(formData);
  const current = getTitle(id);
  if (!current) return { values, message: "This title no longer exists." };

  const opts = parseTitleOptions(values);
  if (!opts.data) return { errors: opts.errors, values, message: "Check the highlighted fields." };
  const input: TitleInput = { ...opts.data };

  const sameMatch = input.tmdb_id === current.tmdb_id && input.type === current.type;
  if (input.tmdb_id) {
    const existing = findTitleByTmdb(input.type, input.tmdb_id);
    if (existing && existing.id !== id) return { values, message: `That TMDB match is already used by "${existing.name}".` };
  }
  if (input.tmdb_id && !sameMatch) {
    const meta = await tmdbMeta(input.type, input.tmdb_id, values);
    Object.assign(input, { ...meta, year: input.year ?? meta.year });
  } else if (input.tmdb_id) {
    Object.assign(input, { overview: current.overview, poster_path: current.poster_path, total_episodes: current.total_episodes });
  }

  // An archived title stays unmonitored until it's brought back from the archive.
  if (current.archived_at !== null) input.monitored = false;
  updateTitle(id, input);
  const changed = changedFields(current, input);
  if (changed.length) logEvent("info", `Title edited (${changed.join(", ")})`, id, "web", { kind: "title_edited", data: { changes: changed } });
  if (!input.monitored) sendCommand({ type: "cancel_title", titleId: id });
  // The folder may have moved.
  sendCommand({ type: "scan_title", titleId: id });
  if (current.tmdb_id && !sameMatch) {
    const old = { tmdbId: current.tmdb_id, type: current.type };
    after(() => removePosters(old.tmdbId, old.type, configDir()).catch(() => {}));
  }
  if (input.tmdb_id && !sameMatch) cachePosterLater(input.type, input.tmdb_id, input.poster_path, true);
  redirect(`/titles/${id}`);
}

const EDITABLE = ["name", "year", "type", "tmdb_id", "folder", "root_folder_id", "season_folders", "naming", "monitored"] as const;

/** Which of a title's editable fields differ (booleans in the form are 0/1 in the database). */
function changedFields(before: object, after: object): string[] {
  const norm = (v: unknown) => (v === true ? 1 : v === false ? 0 : (v ?? null));
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  return EDITABLE.filter((k) => norm(a[k]) !== norm(b[k]));
}

export async function removeTitle(formData: FormData) {
  await requireSession();
  const id = parseId(formData.get("id"));
  const title = getTitle(id);
  // Logged first, so the entry (kept after the title is gone) still says which title it was.
  if (title) logEvent("info", `Deleted ${title.type} "${title.name}"; downloaded files stay on disk`, id, "web", { kind: "title_deleted", data: { name: title.name } });
  deleteTitle(id);
  sendCommand({ type: "cancel_title", titleId: id });
  if (title?.tmdb_id) {
    const ref = { tmdbId: title.tmdb_id, type: title.type };
    after(() => removePosters(ref.tmdbId, ref.type, configDir()).catch(() => {}));
  }
  redirect(title?.type === "movie" ? "/movies" : "/shows");
}

/** Pause or resume a title. Pausing stops its downloads; they resume (with Range) later. */
export async function toggleTitle(formData: FormData) {
  await requireSession();
  const id = parseId(formData.get("id"));
  const monitored = formData.get("monitored") === "1";
  if (getTitle(id)?.archived_at != null) return; // archived: use Unarchive
  setTitleMonitored(id, monitored);
  logEvent("info", monitored ? "Resumed" : "Paused; its downloads stop and resume later", id, "web", { kind: monitored ? "title_resumed" : "title_paused" });
  if (!monitored) sendCommand({ type: "cancel_title", titleId: id });
  refresh();
}

/** Archives a title: no more checks or downloads, but its settings, files and history stay. */
export async function archiveTitle(formData: FormData) {
  await requireSession();
  const title = getTitle(parseId(formData.get("id")));
  if (!title || title.archived_at !== null) return;
  setTitleArchived(title.id, true);
  sendCommand({ type: "cancel_title", titleId: title.id });
  logEvent("info", `Archived ${title.type} "${title.name}"; it's no longer checked or downloaded`, title.id, "web", { kind: "title_archived" });
  refresh();
}

/** Brings a title back from the archive: monitored again, and its sources checked now. */
export async function unarchiveTitle(formData: FormData) {
  await requireSession();
  const title = getTitle(parseId(formData.get("id")));
  if (!title || title.archived_at === null) return;
  setTitleArchived(title.id, false);
  sendCommand({ type: "scan_title", titleId: title.id });
  sendCommand({ type: "check_title", titleId: title.id });
  logEvent("info", `Brought ${title.type} "${title.name}" back from the archive`, title.id, "web", { kind: "title_unarchived" });
  refresh();
}

export async function checkTitleNow(formData: FormData) {
  await requireSession();
  sendCommand({ type: "check_title", titleId: parseId(formData.get("id")) });
  refresh();
}

/** Looks for episodes added to the title's folder by hand. */
export async function rescanTitle(formData: FormData) {
  await requireSession();
  sendCommand({ type: "scan_title", titleId: parseId(formData.get("id")), manual: true });
  refresh();
}

export type SourceFormState = { error?: string; message?: string };

export async function addSource(_prev: SourceFormState, formData: FormData): Promise<SourceFormState> {
  await requireSession();
  const title = getTitle(parseId(formData.get("title_id")));
  if (!title) return { error: "Title no longer exists" };
  const parsed = sourceInput.safeParse({ ...formValues(formData), poll: formData.get("poll") === "on", enabled: true });
  if (!parsed.success) return { error: Object.values(z.flattenError(parsed.error).fieldErrors).flat()[0] ?? "Invalid source" };
  if (findSourceByUrl(parsed.data.url)) return { error: "That page is already a source" };
  const before = titlePasswords(title.id);
  const id = createSource(title.id, parsed.data);
  logEvent("info", `Source added: ${parsed.data.url}`, title.id, "web", { kind: "source_added", data: { url: parsed.data.url } });
  if (title.monitored && parsed.data.poll) sendCommand({ type: "check_now", sourceId: id });
  // A new password may unlock archives that failed before.
  if (parsed.data.password && !before.includes(parsed.data.password)) sendCommand({ type: "extract_title", titleId: title.id });
  refresh();
  return { message: "Source added" };
}

/**
 * Edits a source: URL, password, check interval and whether its page is read.
 * An empty password keeps the saved one; "clear_password" removes it.
 */
export async function editSource(_prev: SourceFormState, formData: FormData): Promise<SourceFormState> {
  await requireSession();
  const source = getSource(parseId(formData.get("id")));
  if (!source) return { error: "This source no longer exists" };
  const typed = String(formData.get("password") ?? "").trim();
  const password = formData.get("clear_password") === "on" ? "" : typed || (source.password ?? "");
  const parsed = sourceInput.safeParse({
    url: formData.get("url"),
    password,
    poll_interval_min: formData.get("poll_interval_min"),
    enabled: source.enabled === 1,
    poll: formData.get("poll") === "on",
  });
  if (!parsed.success) return { error: Object.values(z.flattenError(parsed.error).fieldErrors).flat()[0] ?? "Invalid source" };
  const taken = findSourceByUrl(parsed.data.url);
  if (taken && taken.id !== source.id) return { error: "That page is already a source" };

  const before = titlePasswords(source.title_id);
  const { urlChanged } = updateSource(source.id, parsed.data);
  if (urlChanged) {
    logEvent("info", `Source page changed from ${source.url} to ${parsed.data.url}`, source.title_id, "web", {
      kind: "source_changed",
      data: { from: source.url, to: parsed.data.url },
    });
  }
  else logDebug("web", `Source ${source.url} saved (every ${parsed.data.poll_interval_min} min, ${parsed.data.poll ? "reads the page" : "Click'n'Load only"})`, source.title_id);
  // Check a new page (or one just switched to being read) straight away.
  if (source.monitored && parsed.data.enabled && parsed.data.poll && (urlChanged || !source.poll)) {
    sendCommand({ type: "check_now", sourceId: source.id });
  }
  if (parsed.data.password && !before.includes(parsed.data.password)) sendCommand({ type: "extract_title", titleId: source.title_id });
  refresh();
  return { message: urlChanged ? "Saved; checking the new page" : "Saved" };
}

export async function removeSource(formData: FormData) {
  await requireSession();
  const source = getSource(parseId(formData.get("id")));
  if (!source) return;
  deleteSource(source.id);
  logEvent("info", `Source removed: ${source.url}`, source.title_id, "web", { kind: "source_removed", data: { url: source.url } });
  refresh();
}

export async function toggleSource(formData: FormData) {
  await requireSession();
  const source = getSource(parseId(formData.get("id")));
  if (!source) return;
  const enabled = formData.get("enabled") === "1";
  setSourceEnabled(source.id, enabled);
  logEvent("info", `Source ${enabled ? "enabled" : "disabled"}: ${source.url}`, source.title_id, "web", {
    kind: enabled ? "source_enabled" : "source_disabled",
    data: { url: source.url },
  });
  refresh();
}

export async function checkSourceNow(formData: FormData) {
  await requireSession();
  const source = getSource(parseId(formData.get("id")));
  if (source) sendCommand({ type: "check_now", sourceId: source.id });
  refresh();
}

export async function retryLink(formData: FormData) {
  await requireSession();
  const link = getLink(parseId(formData.get("id")));
  if (!link) return;
  requeueLink(link.id);
  logEvent("info", `Retrying ${link.url} (by hand)`, link.title_id, "web", { kind: "link_retried", data: { url: link.url, host: link.host } });
  refresh();
}

export async function ignoreLink(formData: FormData) {
  await requireSession();
  const link = getLink(parseId(formData.get("id")));
  if (!link) return;
  setLinkStatus(link.id, "ignored");
  logEvent("info", `Ignored ${link.url}`, link.title_id, "web", { kind: "link_ignored", data: { url: link.url, host: link.host } });
  sendCommand({ type: "cancel_link", linkId: link.id });
  refresh();
}

export type AddLinksState = { message?: string; error?: string };

export async function addLinksManually(_prev: AddLinksState, formData: FormData): Promise<AddLinksState> {
  await requireSession();
  const title = getTitle(parseId(formData.get("id")));
  if (!title) return { error: "Title no longer exists" };

  const tokens = String(formData.get("urls") ?? "").split(/\s+/).filter(Boolean);
  const urls = tokens.filter((t) => /^https?:\/\/\S+$/i.test(t));
  if (urls.length === 0) return { error: "Paste at least one http(s) link" };
  if (urls.length > 500) return { error: "At most 500 links at a time" };

  const password = String(formData.get("archive_password") ?? "").trim() || null;
  const added = addLinks(title.id, null, urls, password);
  logEvent("info", `Added ${added} of ${urls.length} link(s) by hand`, title.id, "web", { kind: "links_added", data: { count: added, via: "hand" } });
  refresh();
  const skipped = tokens.length - urls.length;
  return {
    message: `Added ${added} new link(s)${urls.length > added ? `, ${urls.length - added} already known` : ""}${skipped ? `, ignored ${skipped} non-link(s)` : ""}`,
  };
}

export async function retryExtractions(formData: FormData) {
  await requireSession();
  sendCommand({ type: "extract_title", titleId: parseId(formData.get("id")) });
  refresh();
}

export async function importDlc(_prev: AddLinksState, formData: FormData): Promise<AddLinksState> {
  await requireSession();
  const title = getTitle(parseId(formData.get("id")));
  if (!title) return { error: "Title no longer exists" };
  const file = formData.get("dlc");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a .dlc file" };
  if (file.size > 2 * 1024 * 1024) return { error: "That file is too large to be a DLC container" };

  try {
    const urls = dlcLinks(await decryptDlc(await file.text()));
    if (urls.length === 0) return { error: "The DLC container has no links" };
    const added = addLinks(title.id, null, urls);
    logEvent("info", `Imported ${file.name}: ${added} new of ${urls.length} link(s)`, title.id, "web", { kind: "links_added", data: { count: added, via: file.name } });
    refresh();
    return { message: `Imported ${added} new link(s)${urls.length > added ? `, ${urls.length - added} already known` : ""}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
