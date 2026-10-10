import { listRootFolders } from "@/lib/root-folders";
import { getSettings } from "@/lib/settings";
import { formatBytes } from "../_kit/format";
import type { FormDefaults, RootOption } from "./_add/types";

/** Root folders, Media Management defaults and whether TMDB is set up (server-side). */
export function titleFormProps(): { roots: RootOption[]; defaults: FormDefaults; tmdbReady: boolean } {
  const settings = getSettings();
  const roots: RootOption[] = listRootFolders().map((r) => ({
    id: r.id,
    path: r.path,
    free: r.free_bytes === null ? null : formatBytes(r.free_bytes),
    accessible: r.accessible,
  }));
  return {
    roots,
    defaults: {
      showRootId: settings.defaultShowRootId,
      movieRootId: settings.defaultMovieRootId,
      seasonFolders: settings.defaultSeasonFolders,
    },
    tmdbReady: Boolean(settings.tmdbApiKey),
  };
}
