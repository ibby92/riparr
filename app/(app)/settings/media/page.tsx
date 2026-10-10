import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { listRootFolders } from "@/lib/root-folders";
import { getSettings } from "@/lib/settings";
import { MediaForm, type RootRow } from "./media-form";

export const metadata: Metadata = { title: "Media Management" };

export default function MediaSettingsPage() {
  return (
    <Suspense fallback={<div className="card h-96 animate-pulse" />}>
      <Media />
    </Suspense>
  );
}

async function Media() {
  await connection();
  const settings = getSettings();
  const roots: RootRow[] = listRootFolders().map((r) => ({
    id: r.id,
    path: r.path,
    accessible: r.accessible,
    freeBytes: r.free_bytes,
    totalBytes: r.total_bytes,
    titleCount: r.title_count,
    overlaps: r.overlaps,
  }));
  return (
    <MediaForm
      roots={roots}
      settings={{
        defaultShowRootId: settings.defaultShowRootId,
        defaultMovieRootId: settings.defaultMovieRootId,
        defaultSeasonFolders: settings.defaultSeasonFolders,
        cnlEnabled: settings.cnlEnabled,
      }}
    />
  );
}
