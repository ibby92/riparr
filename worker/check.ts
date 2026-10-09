import type { Container, ContainerStatus } from "@/lib/containers";
import { crawlContainer } from "@/lib/crawlers";
import { NeedsAttentionError } from "@/lib/errors";
import { addLinks } from "@/lib/links";
import { fetchFor } from "@/lib/net";
import { getSettings } from "@/lib/settings";

export type CheckResult = {
  status: ContainerStatus;
  error?: string;
  newLinks: number;
  source?: string;
};

/** Crawls one container and stores any links not seen before. */
export async function checkContainer(container: Container, signal: AbortSignal): Promise<CheckResult> {
  try {
    const { links, items, source } = await crawlContainer(container.url, {
      password: container.password,
      signal,
      flaresolverrUrl: getSettings().flaresolverrUrl || null,
      siteFetch: fetchFor("container"),
    });
    return { status: "ok", newLinks: addLinks(container.id, links, null, items), source };
  } catch (err) {
    if (err instanceof NeedsAttentionError) {
      return { status: "needs_attention", error: err.message, newLinks: 0 };
    }
    throw err;
  }
}
