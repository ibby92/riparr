import Link from "next/link";
import type { LinkStatus, LinkWithProgress } from "@/lib/links";
import { ignoreLink, retryLink } from "./containers/actions";
import { formatAgo } from "./ui";

export function formatBytes(n: number | null): string {
  if (n === null) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 || n >= 100 ? 0 : 1)} ${units[i]}`;
}

const STATUS_STYLES: Record<LinkStatus, string> = {
  new: "text-muted",
  queued: "text-muted",
  resolving: "text-accent",
  downloading: "text-accent",
  done: "text-emerald-600 dark:text-emerald-400",
  failed: "text-red-500",
  offline: "text-amber-500",
  ignored: "text-muted line-through",
};

const RETRYABLE: LinkStatus[] = ["failed", "offline", "ignored", "queued"];
const IGNORABLE: LinkStatus[] = ["new", "queued", "resolving", "downloading", "failed", "offline"];

export function LinksTable({
  links,
  now,
  showContainer = false,
  empty = "No links yet.",
}: {
  links: LinkWithProgress[];
  now: number;
  showContainer?: boolean;
  empty?: string;
}) {
  if (links.length === 0) return <p className="p-4 text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Link</th>
            {showContainer && <th className="px-4 py-2 font-medium">Container</th>}
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="w-48 px-4 py-2 font-medium">Progress</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {links.map((l) => {
            const pct = l.bytes_total ? Math.min(100, (l.bytes_done / l.bytes_total) * 100) : null;
            return (
              <tr key={l.id} className="align-top">
                <td className="max-w-md px-4 py-2">
                  <div className="truncate" title={l.url}>
                    <span className="mr-2 rounded bg-zinc-500/15 px-1.5 py-0.5 text-xs">{l.host}</span>
                    {l.url}
                  </div>
                  {l.error && l.status !== "done" && <div className="mt-1 text-xs text-red-500">{l.error}</div>}
                </td>
                {showContainer && (
                  <td className="px-4 py-2">
                    <Link href={`/containers/${l.container_id}`} className="hover:text-accent">
                      {l.container_name}
                    </Link>
                  </td>
                )}
                <td className="px-4 py-2">
                  <span className={STATUS_STYLES[l.status]}>{l.status}</span>
                  {l.status === "queued" && l.retry_at && l.retry_at > now && (
                    <div className="text-xs text-muted">retry {formatAgo(l.retry_at, now)}</div>
                  )}
                </td>
                <td className="px-4 py-2">
                  {l.file_count > 0 && (
                    <>
                      <div className="h-1.5 overflow-hidden rounded bg-border">
                        <div className="h-full bg-accent" style={{ width: `${pct ?? 0}%` }} />
                      </div>
                      <div className="mt-1 text-xs tabular-nums text-muted">
                        {formatBytes(l.bytes_done)} / {formatBytes(l.bytes_total)}
                        {l.file_count > 1 && ` · ${l.files_done}/${l.file_count} files`}
                      </div>
                    </>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-2">
                    {RETRYABLE.includes(l.status) && (
                      <form action={retryLink}>
                        <input type="hidden" name="id" value={l.id} />
                        <button className="btn">{l.status === "queued" ? "Retry now" : "Retry"}</button>
                      </form>
                    )}
                    {IGNORABLE.includes(l.status) && (
                      <form action={ignoreLink}>
                        <input type="hidden" name="id" value={l.id} />
                        <button className="btn">Ignore</button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
