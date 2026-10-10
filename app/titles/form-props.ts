import { listRootFolders } from "@/lib/root-folders";
import { getSettings } from "@/lib/settings";
import { formatBytes } from "../links-table";
import type { RootOption } from "./title-form";

/** Root folders and Media Management defaults for the title form (server-side). */
export function titleFormProps() {
  const settings = getSettings();
  const roots: RootOption[] = listRootFolders().map((r) => ({
    id: r.id,
    path: r.path,
    free: r.free_bytes === null ? null : formatBytes(r.free_bytes),
  }));
  return {
    roots,
    defaults: {
      showRootId: settings.defaultShowRootId,
      movieRootId: settings.defaultMovieRootId,
      seasonFolders: settings.defaultSeasonFolders,
    },
  };
}
