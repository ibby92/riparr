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
import { getLink, requeueLink, setLinkStatus } from "@/lib/links";

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
