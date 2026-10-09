import { createContainer, listContainers } from "./containers";
import { logEvent } from "./events";
import { addLinks } from "./links";
import { normalizeTargetDir } from "./paths";
import { getSettings } from "./settings";

/** Container for Click'n'Load pushes that don't say which page they came from. */
const FALLBACK_URL = "http://clicknload.invalid/";

/** Comparable form of a page URL: no www., no fragment, no trailing slash. */
export function normalizePageUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function containerName(source: URL | null) {
  if (!source) return "Click'n'Load";
  const tail = source.pathname.split("/").filter(Boolean).pop();
  return tail ? `${source.hostname.replace(/^www\./, "")} ${tail}` : source.hostname;
}

/**
 * Files links pushed by a browser's Click'n'Load button. They go to the
 * container whose URL matches `source`, else to a new non-polled container
 * for that page (or a shared fallback when there is no source).
 */
export function receiveClickNLoad(rawLinks: string[], source: string | null) {
  const links = rawLinks.filter((l) => /^https?:\/\//i.test(l.trim())).map((l) => l.trim());
  const sourceKey = source ? normalizePageUrl(source) : null;
  const lookupKey = sourceKey ?? FALLBACK_URL.replace(/\/$/, "");

  let container = listContainers().find((c) => normalizePageUrl(c.url) === lookupKey);
  let created = false;
  if (!container) {
    const settings = getSettings();
    const id = createContainer({
      name: containerName(sourceKey ? new URL(sourceKey) : null),
      url: sourceKey ?? FALLBACK_URL,
      password: null,
      poll_interval_min: 60,
      enabled: true,
      poll: false,
      target_dir: normalizeTargetDir(settings.cnlTargetDir) ?? "",
      path_template: settings.cnlTemplate,
    });
    container = listContainers().find((c) => c.id === id)!;
    created = true;
  }

  const added = links.length ? addLinks(container.id, links) : 0;
  logEvent(
    "info",
    `Click'n'Load: received ${links.length} link(s), ${added} new${created ? " (new container)" : ""}`,
    container.id,
  );
  return { containerId: container.id, received: links.length, added, created };
}
