// Client-safe (no DB imports): used by the settings form.
export const NOTIFY_EVENTS = {
  new_links: "New links found",
  download_done: "Download finished",
  download_failed: "Download failed",
  needs_attention: "Needs attention",
} as const;

export type NotifyEvent = keyof typeof NOTIFY_EVENTS;
