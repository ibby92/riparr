import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getSettings } from "@/lib/settings";
import { DownloadsForm } from "./downloads-form";

export const metadata: Metadata = { title: "Downloads" };

export default function DownloadSettingsPage() {
  return (
    <Suspense fallback={<div className="card h-96 animate-pulse" />}>
      <Downloads />
    </Suspense>
  );
}

async function Downloads() {
  await connection();
  const s = getSettings();
  return (
    <DownloadsForm
      settings={{
        concurrency: s.concurrency,
        perHost: s.perHost,
        mbPerSecond: Number((s.bytesPerSecond / 1024 / 1024).toFixed(2)),
        minFreeGb: s.minFreeGb,
        hostPriority: s.hostPriority,
        extractEnabled: s.extractEnabled,
        extractDeleteArchives: s.extractDeleteArchives,
      }}
    />
  );
}
