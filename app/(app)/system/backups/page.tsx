import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Archive } from "lucide-react";
import { configDir } from "@/lib/db";
import { backupsDir } from "@/lib/db/backup";
import { EmptyState, PageHeader, formatBytes } from "../../_kit";
import { backupRows } from "../_data";
import { BackupNowButton, DeleteBackupButton } from "./backup-controls";

export const metadata: Metadata = { title: "Backups" };

export default function BackupsPage() {
  return (
    <>
      <PageHeader
        title="Backups"
        subtitle="Riparr copies its database before every upgrade, and whenever you back up here. The newest 5 copies are kept."
        actions={<BackupNowButton />}
      />
      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
        <Backups />
      </Suspense>
    </>
  );
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const KIND = {
  upgrade: { label: "Before upgrade", className: "bg-info-soft text-info" },
  manual: { label: "Manual", className: "bg-surface-3 text-fg-2" },
  other: { label: "Other", className: "bg-surface-3 text-muted" },
} as const;

async function Backups() {
  await connection();
  const rows = backupRows();
  const dir = backupsDir(configDir());

  return (
    <div className="flex flex-col gap-[22px]">
      <section className="card">
        {rows.length === 0 ? (
          <EmptyState
            icon={Archive}
            title="No backups yet"
            body="One is taken automatically before every database upgrade. Use Back up now for a copy right away."
          />
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1fr)_130px_80px_90px_170px_auto] gap-4 border-b border-border px-5 py-2.5 text-xs font-medium text-muted md:grid">
              <span>Backup</span>
              <span>Type</span>
              <span>Schema</span>
              <span className="text-right">Size</span>
              <span>Created</span>
              <span className="sr-only">Actions</span>
            </div>
            <ul>
              {rows.map((b) => (
                <li key={b.name} className="border-b border-border last:border-b-0">
                  <DeleteBackupButton name={b.name}>
                    <span className="min-w-0 break-all font-mono text-[13px] font-medium text-fg">{b.name}</span>
                    <span>
                      <span className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${KIND[b.kind].className}`}>{KIND[b.kind].label}</span>
                    </span>
                    <span className="text-sm tabular-nums text-muted">
                      <span className="md:hidden">Schema </span>
                      {b.schema ? `v${b.schema}` : "?"}
                    </span>
                    <span className="text-sm tabular-nums text-muted md:text-right">{formatBytes(b.size)}</span>
                    <time dateTime={new Date(b.createdAt).toISOString()} className="text-sm text-muted">
                      {dateFmt.format(b.createdAt)}
                    </time>
                  </DeleteBackupButton>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="flex flex-wrap justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted md:px-5">
          <span>
            Stored in <span className="break-all font-mono">{dir}</span>
          </span>
        </div>
      </section>

      <section className="card p-4 md:p-5">
        <h2 className="font-display text-lg font-medium text-fg">Restoring a backup</h2>
        <p className="mt-1 text-sm text-muted">
          Restore isn&apos;t done from here: the web server and the worker both keep the database open, so it has to be swapped
          while Riparr is stopped.
        </p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-fg">
          <li>
            Stop the container: <code className="font-mono text-[13px]">docker stop riparr</code>
          </li>
          <li>
            In your config folder, move <code className="font-mono text-[13px]">riparr.db</code> aside, and delete{" "}
            <code className="font-mono text-[13px]">riparr.db-wal</code> and <code className="font-mono text-[13px]">riparr.db-shm</code> if they
            exist.
          </li>
          <li>
            Copy the backup over it: <code className="break-all font-mono text-[13px]">cp backups/riparr-…db riparr.db</code>
          </li>
          <li>
            Start the container again: <code className="font-mono text-[13px]">docker start riparr</code>. An older backup is upgraded
            automatically (after another backup).
          </li>
        </ol>
      </section>
    </div>
  );
}
