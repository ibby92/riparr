// Client-safe: notes about container sites with quirks, shown while you enter a source's address.

/** A short note about how Riparr can use this page, or null for sites without quirks. */
export function siteHint(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (/(^|\.)filecrypt\.(cc|co|to|org)$/.test(host)) {
    return "filecrypt often shows a captcha before the links. If this container has one, Riparr can't check it by itself: pass the check in your browser and send the links with Click'n'Load (they're filed under this title), or import the container's .dlc.";
  }
  if (/(^|\.)mkvdrama\.(net|org|com)$/.test(host) && /^\/c\//.test(u.pathname)) {
    return "mkvdrama's /c/ links expire after about a day. When one does, open the show's page there, copy the new link and use Replace URL on this source.";
  }
  return null;
}
