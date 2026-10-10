import { crawlContainer } from "@/lib/crawlers";
import { NeedsAttentionError } from "@/lib/errors";
import { addLinks } from "@/lib/links";
import { fetchFor } from "@/lib/net";
import { getSettings } from "@/lib/settings";
import type { Source } from "@/lib/sources";
import type { SourceStatus } from "@/lib/titles";

export type CheckResult = {
  status: SourceStatus;
  error?: string;
  newLinks: number;
  source?: string;
};

/** Crawls one source page and stores any links its title hasn't seen before. */
export async function checkSource(source: Source, signal: AbortSignal): Promise<CheckResult> {
  try {
    const { links, items, source: reader } = await crawlContainer(source.url, {
      password: source.password,
      signal,
      flaresolverrUrl: getSettings().flaresolverrUrl || null,
      siteFetch: fetchFor("container"),
    });
    return { status: "ok", newLinks: addLinks(source.title_id, source.id, links, null, items), source: reader };
  } catch (err) {
    if (err instanceof NeedsAttentionError) {
      return { status: "needs_attention", error: err.message, newLinks: 0 };
    }
    throw err;
  }
}
