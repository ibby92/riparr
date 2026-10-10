/** Season/episode numbers parsed from a release or file name. */
export type EpisodeRef = { season: number; episode: number };

const PATTERNS: { re: RegExp; season: number | null }[] = [
  { re: /\bS(\d{1,3})[ ._-]?E(\d{1,4})\b/i, season: null }, // S01E02, s1.e2
  { re: /\b(\d{1,2})x(\d{2,3})\b/i, season: null }, // 1x02
  { re: /\bSeason[ ._-]?(\d{1,3})[ ._-]+Episode[ ._-]?(\d{1,4})\b/i, season: null },
  // Episode only (common for single-season dramas): E05, EP05, Ep.05, Episode 5.
  { re: /(?:^|[ ._\-[(])(?:E|EP|Ep\.?|Episode[ ._-]?)(\d{1,4})\b/i, season: 1 },
];

/**
 * Finds the season and episode in a name like "Show.S01E05.1080p.mkv" or "Show EP05".
 * A bare episode number assumes season 1. Null if the name has no episode marker.
 */
export function parseEpisode(name: string | null | undefined): EpisodeRef | null {
  if (!name) return null;
  for (const { re, season } of PATTERNS) {
    const m = re.exec(name);
    if (!m) continue;
    if (season !== null) return { season, episode: Number(m[1]) };
    return { season: Number(m[1]), episode: Number(m[2]) };
  }
  return null;
}
