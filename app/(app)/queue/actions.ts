"use server";

import { refresh } from "next/cache";
import { clearHostLimit } from "@/lib/host-status";
import { requeueLink } from "@/lib/links";
import { requireSession } from "@/lib/session";

/** Ends a host's cooldown now; its waiting links are picked up on the worker's next tick. */
export async function retryHostNow(formData: FormData) {
  await requireSession();
  const host = String(formData.get("host") ?? "");
  if (host) clearHostLimit(host);
  refresh();
}

/** Retries one link now (clears its backoff and attempt count). */
export async function retryLinkNow(formData: FormData) {
  await requireSession();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id) && id > 0) requeueLink(id);
  refresh();
}
