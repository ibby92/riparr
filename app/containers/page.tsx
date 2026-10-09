import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { listContainers } from "@/lib/containers";
import { formatAgo, StatusBadge } from "../ui";
import { checkNow, toggleContainer } from "./actions";

export const metadata: Metadata = { title: "Containers" };

export default function ContainersPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Containers</h1>
        <Link href="/containers/new" className="btn btn-primary">
          Add container
        </Link>
      </div>
      <Suspense fallback={<div className="card h-40 animate-pulse" />}>
        <ContainerTable />
      </Suspense>
    </div>
  );
}

async function ContainerTable() {
  await connection();
  const containers = listContainers();
  if (containers.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-muted">
        No containers yet. Add a container link and Riparr will poll it for new content.
      </div>
    );
  }

  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Links</th>
            <th className="px-4 py-2 font-medium">Last check</th>
            <th className="px-4 py-2 font-medium">Next check</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {containers.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-2">
                <Link href={`/containers/${c.id}`} className="font-medium hover:text-accent">
                  {c.name}
                </Link>
                <div className="max-w-xs truncate text-xs text-muted">{c.url}</div>
              </td>
              <td className="px-4 py-2">
                <StatusBadge status={c.status} enabled={c.enabled === 1} />
              </td>
              <td className="px-4 py-2 tabular-nums">
                {c.done_count} / {c.link_count}
              </td>
              <td className="px-4 py-2 text-muted">{formatAgo(c.last_checked_at, now)}</td>
              <td className="px-4 py-2 text-muted">
                {c.enabled ? (c.next_check_at <= now ? "due" : formatAgo(c.next_check_at, now)) : "—"}
              </td>
              <td className="px-4 py-2">
                <div className="flex justify-end gap-2">
                  <form action={checkNow}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn" disabled={!c.enabled}>
                      Check now
                    </button>
                  </form>
                  <form action={toggleContainer}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="enabled" value={c.enabled ? "0" : "1"} />
                    <button className="btn">{c.enabled ? "Pause" : "Resume"}</button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
