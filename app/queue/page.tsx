import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { activeLinks, recentlyFinishedLinks } from "@/lib/links";
import { AutoRefresh } from "../auto-refresh";
import { LinksTable } from "../links-table";

export const metadata: Metadata = { title: "Queue" };

export default function QueuePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Queue</h1>
      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
        <Queue />
      </Suspense>
    </div>
  );
}

async function Queue() {
  await connection();
  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const active = activeLinks();
  return (
    <>
      {active.length > 0 && <AutoRefresh />}
      <section className="card">
        <h2 className="border-b border-border px-4 py-2 font-medium">Active and waiting ({active.length})</h2>
        <LinksTable links={active} now={now} showTitle empty="Nothing queued." />
      </section>
      <section className="card">
        <h2 className="border-b border-border px-4 py-2 font-medium">Recently finished</h2>
        <LinksTable links={recentlyFinishedLinks(50)} now={now} showTitle empty="Nothing yet." />
      </section>
    </>
  );
}
