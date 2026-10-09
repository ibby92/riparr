"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { sendCommand } from "@/lib/commands";
import {
  containerInput,
  createContainer,
  deleteContainer,
  findContainerByUrl,
  getContainer,
  setContainerEnabled,
  updateContainer,
} from "@/lib/containers";
import { decryptDlc, dlcLinks } from "@/lib/crawlers";
import { logEvent } from "@/lib/events";
import { addLinks, getLink, requeueLink, setLinkStatus } from "@/lib/links";

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

export async function saveContainer(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const rawId = formData.get("id");
  const id = rawId ? parseId(rawId) : null;

  const values = Object.fromEntries(
    [...formData].filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  const parsed = containerInput.safeParse(values);
  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const existing = findContainerByUrl(parsed.data.url);
  if (existing && existing.id !== id) {
    return { errors: { url: [`Already watched as "${existing.name}"`] }, values };
  }

  let savedId: number;
  if (id) {
    const before = getContainer(id);
    if (!before) return { message: "Container no longer exists", values };
    updateContainer(id, parsed.data);
    if (before.password !== parsed.data.password) sendCommand({ type: "extract_container", containerId: id });
    savedId = id;
  } else {
    savedId = createContainer(parsed.data);
    if (parsed.data.enabled && parsed.data.poll) sendCommand({ type: "check_now", containerId: savedId });
  }
  redirect(`/containers/${savedId}`);
}

export async function removeContainer(formData: FormData) {
  await requireSession();
  const id = parseId(formData.get("id"));
  deleteContainer(id);
  sendCommand({ type: "cancel_container", containerId: id });
  redirect("/containers");
}

export async function toggleContainer(formData: FormData) {
  await requireSession();
  const id = parseId(formData.get("id"));
  const enabled = formData.get("enabled") === "1";
  setContainerEnabled(id, enabled);
  // Pausing also stops its in-flight downloads; they resume (with Range) when re-enabled.
  if (!enabled) sendCommand({ type: "cancel_container", containerId: id });
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

export async function checkNow(formData: FormData) {
  await requireSession();
  sendCommand({ type: "check_now", containerId: parseId(formData.get("id")) });
  refresh();
}

export type AddLinksState = { message?: string; error?: string };

export async function addLinksManually(_prev: AddLinksState, formData: FormData): Promise<AddLinksState> {
  await requireSession();
  const container = getContainer(parseId(formData.get("id")));
  if (!container) return { error: "Container no longer exists" };

  const tokens = String(formData.get("urls") ?? "").split(/\s+/).filter(Boolean);
  const urls = tokens.filter((t) => /^https?:\/\/\S+$/i.test(t));
  if (urls.length === 0) return { error: "Paste at least one http(s) link" };
  if (urls.length > 500) return { error: "At most 500 links at a time" };

  const password = String(formData.get("archive_password") ?? "").trim() || null;
  const added = addLinks(container.id, urls, password);
  logEvent("info", `Added ${added} of ${urls.length} link(s) by hand`, container.id);
  refresh();
  const skipped = tokens.length - urls.length;
  return {
    message: `Added ${added} new link(s)${urls.length > added ? `, ${urls.length - added} already known` : ""}${skipped ? `, ignored ${skipped} non-link(s)` : ""}`,
  };
}

export async function retryExtractions(formData: FormData) {
  await requireSession();
  sendCommand({ type: "extract_container", containerId: parseId(formData.get("id")) });
  refresh();
}

export async function importDlc(_prev: AddLinksState, formData: FormData): Promise<AddLinksState> {
  await requireSession();
  const container = getContainer(parseId(formData.get("id")));
  if (!container) return { error: "Container no longer exists" };
  const file = formData.get("dlc");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a .dlc file" };
  if (file.size > 2 * 1024 * 1024) return { error: "That file is too large to be a DLC container" };

  try {
    const urls = dlcLinks(await decryptDlc(await file.text()));
    if (urls.length === 0) return { error: "The DLC container has no links" };
    const added = addLinks(container.id, urls);
    logEvent("info", `Imported ${file.name}: ${added} new of ${urls.length} link(s)`, container.id);
    refresh();
    return { message: `Imported ${added} new link(s)${urls.length > added ? `, ${urls.length - added} already known` : ""}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
