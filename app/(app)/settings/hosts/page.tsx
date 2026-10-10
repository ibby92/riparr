import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ACCOUNT_FIELDS, listHostAccounts } from "@/lib/host-accounts";
import { HostsForm, type HostAccountView } from "./hosts-form";

export const metadata: Metadata = { title: "Hosts" };

export default function HostSettingsPage() {
  return (
    <Suspense fallback={<div className="card h-96 animate-pulse" />}>
      <Hosts />
    </Suspense>
  );
}

async function Hosts() {
  await connection();
  const saved = listHostAccounts();
  // Secrets never reach the browser: only whether one is saved.
  const hosts: HostAccountView[] = Object.entries(ACCOUNT_FIELDS).map(([host, spec]) => ({
    host,
    label: spec.label,
    fields: spec.fields.map((f) => ({
      key: f.key,
      label: f.label,
      hint: f.hint,
      secret: f.secret,
      isSet: Boolean(saved[host]?.[f.key]),
      value: f.secret ? "" : (saved[host]?.[f.key] ?? ""),
    })),
  }));
  return <HostsForm hosts={hosts} />;
}
