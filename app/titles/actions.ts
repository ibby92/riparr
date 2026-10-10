"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { sendCommand } from "@/lib/commands";
import { decryptDlc, dlcLinks } from "@/lib/crawlers";
import { logEvent } from "@/lib/events";
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
} from "@/lib/sources";
import {
  createTitle,
  defaultFolder,
  deleteTitle,
  findTitleByTmdb,
  getTitle,
  setTitleMonitored,
  titleInput,
  updateTitle,
} from "@/lib/titles";

export type FormState = {
  errors?: Record<string, string[] | undefined>;
  message?: string;
  /** Echoed back so the form keeps the user's input after React resets it. */
  values?: Record<string, string>;
};

function parseId(value: FormDataEntryValue | null): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid id");
  return id;
}

function formValues(formData: FormData) {
  return Object.fromEntries([...formData].filter((e): e is [string, string] => typeof e[1] === "string"));
}

/** Creates or updates a title. A new title can come with its first source (`source_url`). */
export async function saveTitle(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const rawId = formData.get("id");
  const id = rawId ? parseId(rawId) : null;
  const values = formValues(formData);

  const withFolder = {
    ...values,
    folder: values.folder?.trim() || (values.name ? defaultFolder(values.name, values.type === "movie" ? "movie" : "show", Number(values.year) || null) : ""),
  };
  const parsed = titleInput.safeParse(withFolder);
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, values };
  if (!getRootFolder(parsed.data.root_folder_id)) return { errors: { root_folder_id: ["Choose a root folder"] }, values };
  if (parsed.data.tmdb_id) {
    const existing = findTitleByTmdb(parsed.data.type, parsed.data.tmdb_id);
    if (existing && existing.id !== id) return { errors: { tmdb_id: [`Already in the library as "${existing.name}"`] }, values };
  }

  if (id) {
    if (!getTitle(id)) return { message: "Title no longer exists", values };
    updateTitle(id, parsed.data);
    if (!parsed.data.monitored) sendCommand({ type: "cancel_title", titleId: id });
    redirect(`/titles/${id}`);
  }

  let source = null;
  if (values.source_url?.trim()) {
    const s = sourceInput.safeParse({
      url: values.source_url,
      password: values.source_password,
      poll_interval_min: values.source_poll_interval_min || "60",
      poll: values.source_poll === "on",
      enabled: true,
    });
    if (!s.success) {
      const f = z.flattenError(s.error).fieldErrors;
      return { errors: { source_url: f.url, source_poll_interval_min: f.poll_interval_min }, values };
    }
    const taken = findSourceByUrl(s.data.url);
    if (taken) return { errors: { source_url: ["That page is already a source of another title"] }, values };
    source = s.data;
  }

  const newId = createTitle(parsed.data);
  if (source) {
    createSource(newId, source);
    if (parsed.data.monitored && source.poll) sendCommand({ type: "check_title", titleId: newId });
  }
  redirect(`/titles/${newId}`);
}

export async function removeTitle(formData: FormData) {
  await requireSession();
  const id = parseId(formData.get("id"));
  deleteTitle(id);
  sendCommand({ type: "cancel_title", titleId: id });
  redirect("/titles");
}

/** Pause or resume a title. Pausing stops its downloads; they resume (with Range) later. */
export async function toggleTitle(formData: FormData) {
  await requireSession();
  const id = parseId(formData.get("id"));
  const monitored = formData.get("monitored") === "1";
  setTitleMonitored(id, monitored);
  if (!monitored) sendCommand({ type: "cancel_title", titleId: id });
  refresh();
}

export async function checkTitleNow(formData: FormData) {
  await requireSession();
  sendCommand({ type: "check_title", titleId: parseId(formData.get("id")) });
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
  if (title.monitored && parsed.data.poll) sendCommand({ type: "check_now", sourceId: id });
  // A new password may unlock archives that failed before.
  if (parsed.data.password && !before.includes(parsed.data.password)) sendCommand({ type: "extract_title", titleId: title.id });
  refresh();
  return { message: "Source added" };
}

export async function removeSource(formData: FormData) {
  await requireSession();
  deleteSource(parseId(formData.get("id")));
  refresh();
}

export async function toggleSource(formData: FormData) {
  await requireSession();
  setSourceEnabled(parseId(formData.get("id")), formData.get("enabled") === "1");
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
  requeueLink(parseId(formData.get("id")));
  refresh();
}

export async function ignoreLink(formData: FormData) {
  await requireSession();
  const link = getLink(parseId(formData.get("id")));
  if (!link) return;
  setLinkStatus(link.id, "ignored");
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
  logEvent("info", `Added ${added} of ${urls.length} link(s) by hand`, title.id);
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
    logEvent("info", `Imported ${file.name}: ${added} new of ${urls.length} link(s)`, title.id);
    refresh();
    return { message: `Imported ${added} new link(s)${urls.length > added ? `, ${urls.length - added} already known` : ""}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
