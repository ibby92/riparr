import { logEvent } from "./events";
import { addLinks } from "./links";
import { listRootFolders } from "./root-folders";
import { getSettings } from "./settings";
import { createSource, listSources } from "./sources";
import { createTitle, defaultFolder } from "./titles";

/** Source URL for Click'n'Load pushes that don't say which page they came from. */
const FALLBACK_URL = "http://clicknload.invalid/";

export class ClickNLoadError extends Error {
  name = "ClickNLoadError";
}

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

function titleName(source: URL | null) {
  if (!source) return "Click'n'Load";
  const tail = source.pathname.split("/").filter(Boolean).pop();
  return tail ? `${source.hostname.replace(/^www\./, "")} ${tail}` : source.hostname;
}

/**
 * Files links pushed by a browser's Click'n'Load button. They go to the title
 * whose source URL matches `source`; otherwise a new show is created in the
 * default show root folder with a non-polled source for that page (or a shared
 * fallback when there is no source). Throws ClickNLoadError if there's nowhere to put it.
 */
export function receiveClickNLoad(rawLinks: string[], source: string | null, archivePassword: string | null = null) {
  const links = rawLinks.filter((l) => /^https?:\/\//i.test(l.trim())).map((l) => l.trim());
  const sourceKey = source ? normalizePageUrl(source) : null;
  const lookupKey = sourceKey ?? FALLBACK_URL.replace(/\/$/, "");

  let match = listSources().find((s) => normalizePageUrl(s.url) === lookupKey);
  let created = false;
  if (!match) {
    const settings = getSettings();
    const roots = listRootFolders();
    const root = roots.find((r) => r.id === settings.defaultShowRootId) ?? roots[0];
    if (!root) throw new ClickNLoadError("Add a root folder in Settings → Media Management first");
    const name = titleName(sourceKey ? new URL(sourceKey) : null);
    const titleId = createTitle({
      type: "show",
      name,
      year: null,
      tmdb_id: null,
      overview: null,
      poster_path: null,
      total_episodes: null,
      root_folder_id: root.id,
      folder: defaultFolder(name, "show", null),
      season_folders: settings.defaultSeasonFolders,
      naming: "{filename}",
      monitored: true,
    });
    const sourceId = createSource(titleId, {
      url: sourceKey ?? FALLBACK_URL,
      password: null,
      poll_interval_min: 60,
      enabled: true,
      poll: false,
    });
    match = listSources().find((s) => s.id === sourceId)!;
    created = true;
  }

  const added = links.length ? addLinks(match.title_id, match.id, links, archivePassword) : 0;
  logEvent(
    "info",
    `Click'n'Load: received ${links.length} link(s), ${added} new${created ? " (new title)" : ""}`,
    match.title_id,
    "cnl",
    { kind: "links_added", data: { count: added, via: "Click'n'Load" } },
  );
  return { titleId: match.title_id, sourceId: match.id, received: links.length, added, created };
}
