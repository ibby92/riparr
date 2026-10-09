import type { Container, ContainerStatus } from "@/lib/containers";
import { crawlContainer } from "@/lib/crawlers";
import { NeedsAttentionError } from "@/lib/errors";
import { addLinks } from "@/lib/links";

export type CheckResult = {
  status: ContainerStatus;
  error?: string;
  newLinks: number;
  source?: string;
};

/** Crawls one container and stores any links not seen before. */
export async function checkContainer(container: Container, signal: AbortSignal): Promise<CheckResult> {
  try {
    const { links, source } = await crawlContainer(container.url, { password: container.password, signal });
    return { status: "ok", newLinks: addLinks(container.id, links), source };
  } catch (err) {
    if (err instanceof NeedsAttentionError) {
      return { status: "needs_attention", error: err.message, newLinks: 0 };
    }
    throw err;
  }
}
