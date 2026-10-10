import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { listTitles } from "@/lib/titles";
import { formatAgo, StatusBadge } from "../ui";
import { checkTitleNow, toggleTitle } from "./actions";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Library</h1>
        <Link href="/titles/new" className="btn btn-primary">
          Add title
        </Link>
      </div>
      <Suspense fallback={<div className="card h-40 animate-pulse" />}>
        <TitleTable />
      </Suspense>
    </div>
  );
}

async function TitleTable() {
  await connection();
  const titles = listTitles();
  if (titles.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-muted">
        Your library is empty. Add a show or movie and the pages that list its links; Riparr checks them for new content.
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
            <th className="px-4 py-2 font-medium">Title</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Episodes</th>
            <th className="px-4 py-2 font-medium">Sources</th>
            <th className="px-4 py-2 font-medium">Last check</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {titles.map((t) => (
            <tr key={t.id}>
              <td className="px-4 py-2">
                <Link href={`/titles/${t.id}`} className="font-medium hover:text-accent">
                  {t.name}
                  {t.year ? ` (${t.year})` : ""}
                </Link>
                <div className="max-w-xs truncate text-xs text-muted">
                  {t.type === "show" ? "Show" : "Movie"} · {t.root_path}/{t.folder}
                </div>
              </td>
              <td className="px-4 py-2">
                <StatusBadge status={t.status} />
              </td>
              <td className="px-4 py-2 tabular-nums">
                {t.type === "show" ? `${t.episodes_done}${t.total_episodes ? ` / ${t.total_episodes}` : ""}` : t.done_count ? "Downloaded" : "—"}
              </td>
              <td className="px-4 py-2 tabular-nums">{t.source_count}</td>
              <td className="px-4 py-2 text-muted">{formatAgo(t.last_checked_at, now)}</td>
              <td className="px-4 py-2">
                <div className="flex justify-end gap-2">
                  <form action={checkTitleNow}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className="btn" disabled={!t.monitored || !t.source_count}>
                      Check now
                    </button>
                  </form>
                  <form action={toggleTitle}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="monitored" value={t.monitored ? "0" : "1"} />
                    <button className="btn">{t.monitored ? "Pause" : "Resume"}</button>
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
