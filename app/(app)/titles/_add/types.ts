// Shared, client-safe shapes for the Add/Edit title forms.

export type RootOption = { id: number; path: string; free: string | null; accessible: boolean };

export type FormDefaults = { showRootId: number | null; movieRootId: number | null; seasonFolders: boolean };

export type TmdbHit = {
  tmdbId: number;
  type: "show" | "movie";
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string;
  posterPath: string | null;
  posterUrl: string | null;
  inLibrary: { id: number; name: string } | null;
};

export type TmdbDetails = { summary: string; totalEpisodes: number | null };

export type ReleaseHint = { query: string; year?: number; url?: string };

export type FormState = {
  errors?: Record<string, string[] | undefined>;
  message?: string;
  /** Echoed back so the form keeps the user's input. */
  values?: Record<string, string>;
};
