import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { maskProxyUrl } from "@/lib/net";
import { getSettings } from "@/lib/settings";
import { ConnectionsForm } from "./connections-form";

export const metadata: Metadata = { title: "Connections" };

export default function ConnectionSettingsPage() {
  return (
    <Suspense fallback={<div className="card h-96 animate-pulse" />}>
      <Connections />
    </Suspense>
  );
}

async function Connections() {
  await connection();
  const s = getSettings();
  // Secrets never reach the browser: the TMDB key only as "set", the proxy password masked.
  return (
    <ConnectionsForm
      settings={{
        tmdbKeySet: Boolean(s.tmdbApiKey),
        tmdbLanguage: s.tmdbLanguage,
        proxyUrl: maskProxyUrl(s.proxyUrl),
        proxyScope: s.proxyScope,
        flaresolverrUrl: s.flaresolverrUrl,
      }}
      envProxy={Boolean(process.env.RIPARR_PROXY_URL)}
    />
  );
}
