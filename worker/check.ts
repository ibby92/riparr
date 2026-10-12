import { crawlContainer } from "@/lib/crawlers";
import { NeedsAttentionError } from "@/lib/errors";
import { addLinks } from "@/lib/links";
import { logDebug } from "@/lib/events";
import { fetchFor, proxyUrlSetting } from "@/lib/net";
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
  const log = (message: string) => logDebug("check", message, source.title_id);
  const settings = getSettings();
  const started = Date.now();
  logDebug(
    "check",
    () => `Checking ${source.url}${proxyUrlSetting() ? " through the proxy" : ""}${settings.flaresolverrUrl ? " (FlareSolverr available)" : ""}`,
    source.title_id,
  );
  try {
    const { links, items, source: reader } = await crawlContainer(source.url, {
      password: source.password,
      signal,
      flaresolverrUrl: settings.flaresolverrUrl || null,
      siteFetch: fetchFor("container"),
      log,
    });
    const newLinks = addLinks(source.title_id, source.id, links, null, items);
    log(`Check done in ${Date.now() - started} ms: ${links.length} link(s) on the page, ${newLinks} new`);
    return { status: "ok", newLinks, source: reader };
  } catch (err) {
    log(`Check stopped after ${Date.now() - started} ms: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    if (err instanceof NeedsAttentionError) {
      return { status: "needs_attention", error: err.message, newLinks: 0 };
    }
    throw err;
  }
}
