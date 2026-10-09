// Client-safe (no node imports): hosts Riparr can download from, for the settings UI.
// Keep in sync with RESOLVERS in lib/hosts/index.ts (a test checks this).
export const KNOWN_HOSTS = [
  { id: "gofile", label: "gofile" },
  { id: "pixeldrain", label: "pixeldrain" },
  { id: "mega", label: "MEGA" },
] as const;
