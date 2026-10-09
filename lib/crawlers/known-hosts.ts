/** File hosts whose links the plain-page crawler picks up. Subdomains match too. */
export const KNOWN_HOST_DOMAINS = [
  "gofile.io",
  "pixeldrain.com",
  "pixeldrain.net",
  "pixeldra.in",
  "mega.nz",
  "mega.co.nz",
  // 1fichier and its alias domains
  "1fichier.com",
  "alterupload.com",
  "cjoint.net",
  "desfichiers.com",
  "dfichiers.com",
  "dl4free.com",
  "megadl.fr",
  "mesfichiers.org",
  "piecejointe.net",
  "pjointe.com",
  "tenvoi.com",
  "buzzheavier.com",
  "bzzhr.co",
  "flashbang.sh",
  "trashbytes.net",
  "krakenfiles.com",
  "mediafire.com",
  "rapidgator.net",
  "rg.to",
  "nitroflare.com",
  "nitro.download",
  "ddownload.com",
  "ddl.to",
  "katfile.com",
  "turbobit.net",
  "hitfile.net",
  "uploadgig.com",
  "send.cm",
  "sendspace.com",
  "workupload.com",
  "qiwi.gg",
  "files.fm",
  "files.catbox.moe",
  "litter.catbox.moe",
  "datanodes.to",
  "usersdrive.com",
  "hexload.com",
  "filespace.com",
  "uptobox.com",
  "drive.google.com",
  "dropbox.com",
  "fuckingfast.co",
] as const;

const DOMAINS = new Set<string>(KNOWN_HOST_DOMAINS);

/** The known domain `url` belongs to, or null. Bare homepages (no path or query) don't count. */
export function knownHostDomain(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.pathname.replace(/\/+$/, "") === "" && !u.search && !u.hash) return null;
  const labels = u.hostname.toLowerCase().replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    if (DOMAINS.has(candidate)) return candidate;
  }
  return null;
}

export function isKnownHostUrl(url: string): boolean {
  return knownHostDomain(url) !== null;
}
