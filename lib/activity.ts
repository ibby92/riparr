// Client-safe (no DB imports): the kinds of user-facing activity History shows.
// A log entry is activity when logEvent() is given one of these kinds; everything else
// (worker restarts, retries, rescans, debug detail) is only on System → Logs.

export type ActivityCategory = "downloads" | "library" | "problems";

export const ACTIVITY_CATEGORIES: Record<ActivityCategory, string> = {
  downloads: "Downloads",
  library: "Library changes",
  problems: "Problems",
};

export const ACTIVITY_KINDS = {
  // Downloads
  downloaded: { category: "downloads", label: "Downloaded" },
  in_folder: { category: "downloads", label: "Already in the folder" },
  extracted: { category: "downloads", label: "Extracted" },
  links_found: { category: "downloads", label: "New links found" },
  links_added: { category: "downloads", label: "Links added" },
  // Library changes (things you did)
  title_added: { category: "library", label: "Title added" },
  title_edited: { category: "library", label: "Title edited" },
  title_deleted: { category: "library", label: "Title deleted" },
  title_paused: { category: "library", label: "Title paused" },
  title_resumed: { category: "library", label: "Title resumed" },
  source_added: { category: "library", label: "Source added" },
  source_changed: { category: "library", label: "Source changed" },
  source_removed: { category: "library", label: "Source removed" },
  source_enabled: { category: "library", label: "Source enabled" },
  source_disabled: { category: "library", label: "Source disabled" },
  link_retried: { category: "library", label: "Link retried" },
  link_ignored: { category: "library", label: "Link ignored" },
  root_folder_added: { category: "library", label: "Root folder added" },
  root_folder_removed: { category: "library", label: "Root folder removed" },
  settings_changed: { category: "library", label: "Settings changed" },
  // Problems, and their resolution
  needs_attention: { category: "problems", label: "Needs attention" },
  check_failed: { category: "problems", label: "Source keeps failing" },
  download_failed: { category: "problems", label: "Download failed" },
  no_copy: { category: "problems", label: "No working copy" },
  extract_failed: { category: "problems", label: "Extraction failed" },
  archive_password: { category: "problems", label: "Archive needs a password" },
  host_limited: { category: "problems", label: "Host limited" },
  host_limit_ended: { category: "problems", label: "Host limit ended" },
  disk_low: { category: "problems", label: "Low on space" },
  disk_recovered: { category: "problems", label: "Space recovered" },
} as const satisfies Record<string, { category: ActivityCategory; label: string }>;

export type ActivityKind = keyof typeof ACTIVITY_KINDS;

export function kindsIn(category: ActivityCategory): ActivityKind[] {
  return (Object.keys(ACTIVITY_KINDS) as ActivityKind[]).filter((k) => ACTIVITY_KINDS[k].category === category);
}

/** A file in a download activity. */
export type ActivityFile = { name: string; season: number | null; episode: number | null; size: number | null };

/** Structured details some activities carry, for richer History rows. */
export type ActivityData = {
  host?: string;
  bytes?: number;
  files?: ActivityFile[];
  count?: number;
  via?: string;
  url?: string;
  from?: string;
  to?: string;
  until?: number;
  /** A title's name, for entries that outlive the title (deleted). */
  name?: string;
  /** A folder (root folder, low-space disk). */
  path?: string;
  section?: string;
  /** What changed, e.g. settings "cnlEnabled true → false" or title fields. */
  changes?: string[];
};
