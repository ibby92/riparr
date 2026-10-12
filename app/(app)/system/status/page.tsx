import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CircleCheck, CircleDashed, TriangleAlert } from "lucide-react";
import { formatter, timeZone } from "@/lib/time";
import { configDir } from "@/lib/db";
import { SCHEMA_VERSION } from "@/lib/db/migrations";
import { listRootFolders } from "@/lib/root-folders";
import { HEARTBEAT_INTERVAL_MS, getSettings, workerHeartbeatAge } from "@/lib/settings";
import { proxyUrlSetting } from "@/lib/net";
import pkg from "@/package.json";
import { PageHeader, ProgressBar, StatusPill, formatAgo, formatBytes, formatDuration } from "../../_kit";
import { backupRows, databaseInfo, libraryCounts } from "../_data";

export const metadata: Metadata = { title: "Status" };

export default function StatusPage() {
  return (
    <>
      <PageHeader title="Status" subtitle="How this Riparr instance is doing." />
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <Status />
      </Suspense>
    </>
  );
}

function SysCard({ label, badge, value, children }: { label: string; badge?: ReactNode; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="card flex min-w-0 flex-col gap-2 px-4 py-4 md:px-[18px]">
      <div className="flex items-center justify-between gap-2 text-sm text-fg-2">
        <span className="min-w-0 truncate">{label}</span>
        {badge}
      </div>
      <div className="font-display text-2xl leading-tight tabular-nums text-fg">{value}</div>
      {children && <div className="flex flex-col gap-1.5 text-xs text-muted">{children}</div>}
    </div>
  );
}

function SpaceCard({ label, space, low }: { label: string; space: { free: number; total: number } | null; low?: boolean }) {
  return (
    <SysCard
      label={label}
      badge={
        space ? (
          low ? <StatusPill state="waiting" label="Low space" /> : <span className="text-xs tabular-nums text-muted">{formatBytes(space.total)}</span>
        ) : (
          <StatusPill state="error" label="Not reachable" />
        )
      }
      value={space ? `${formatBytes(space.free)} free` : "Unknown"}
    >
      {space && space.total > 0 && (
        <ProgressBar size="sm" total={space.total} segments={[{ value: space.total - space.free, tone: "done" }]} label={`${label} used space`} />
      )}
    </SysCard>
  );
}

function Check({ ok, title, detail }: { ok: boolean | null; title: string; detail?: ReactNode }) {
  const Icon = ok === null ? CircleDashed : ok ? CircleCheck : TriangleAlert;
  const tone = ok === null ? "text-faint" : ok ? "text-good" : "text-warn";
  return (
    <li className="flex items-start gap-3 border-t border-border px-4 py-3 text-sm md:px-5">
      <Icon size={18} strokeWidth={1.75} className={`mt-px shrink-0 ${tone}`} aria-hidden="true" />
      <div className="min-w-0">
        <span className="text-fg">{title}</span>
        {detail && <small className="block break-words text-xs text-muted">{detail}</small>}
      </div>
    </li>
  );
}

async function Status() {
  await connection();
  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const heartbeat = workerHeartbeatAge();
  const workerOnline = heartbeat !== null && heartbeat < HEARTBEAT_INTERVAL_MS * 3;
  const db = databaseInfo();
  const roots = listRootFolders();
  const lastBackup = backupRows()[0];
  const counts = libraryCounts();
  const settings = getSettings();
  const minFree = settings.minFreeGb * 1024 ** 3;
  const pending = SCHEMA_VERSION - db.version;

  return (
    <div className="flex flex-col gap-[22px]">
      <section className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Overview">
        <SysCard label="Version" value={pkg.version}>
          <span>
            Node {process.version.replace(/^v/, "")} · web server up {formatDuration(process.uptime())}
          </span>
        </SysCard>
        <SysCard
          label="Worker"
          badge={workerOnline ? <StatusPill state="ok" label="Online" /> : <StatusPill state="error" label="Offline" />}
          value={heartbeat === null ? "Never seen" : formatAgo(now - heartbeat, now)}
        >
          <span>{workerOnline ? "Last heartbeat; it checks in every few seconds." : "No recent heartbeat. Check the container logs."}</span>
        </SysCard>
        <SysCard
          label="Database"
          badge={
            <span className="rounded-pill bg-info-soft px-2 py-0.5 text-xs font-medium text-info">Schema v{db.version}</span>
          }
          value={formatBytes(db.size + db.walSize)}
        >
          <span className="break-all font-mono">{db.path}</span>
          <span>
            {pending > 0 ? `${pending} migration${pending === 1 ? "" : "s"} pending (the worker applies them on start)` : "Up to date"}
            {` · ${counts.shows} show${counts.shows === 1 ? "" : "s"}, ${counts.movies} movie${counts.movies === 1 ? "" : "s"}`}
          </span>
        </SysCard>
        {roots.map((r) => (
          <SpaceCard
            key={r.id}
            label={r.path}
            space={r.accessible && r.free_bytes != null && r.total_bytes != null ? { free: r.free_bytes, total: r.total_bytes } : null}
            low={minFree > 0 && r.free_bytes != null && r.free_bytes < minFree}
          />
        ))}
        <SysCard
          label="Last backup"
          badge={lastBackup ? <StatusPill state="ok" label="OK" /> : <StatusPill state="paused" label="None" />}
          value={lastBackup ? formatAgo(lastBackup.createdAt, now) : "Never"}
        >
          <span>
            {lastBackup ? `${lastBackup.name} · ${formatBytes(lastBackup.size)} · ` : "Taken before every upgrade, or on demand · "}
            <Link href="/system/backups" className="link">
              Backups
            </Link>
          </span>
        </SysCard>
      </section>

      <section className="card overflow-hidden">
        <header className="px-4 pb-3 pt-4 md:px-5">
          <h2 className="font-display text-lg font-medium text-fg">Configuration</h2>
          <p className="text-xs text-muted">From saved settings; use the Test buttons in Settings to check connections live.</p>
        </header>
        <ul>
          <Check
            ok={roots.length > 0 && roots.every((r) => r.accessible)}
            title={roots.length === 0 ? "No root folders yet" : roots.every((r) => r.accessible) ? "Root folders reachable" : "A root folder isn't reachable"}
            detail={<Link href="/settings/media" className="link">Media Management</Link>}
          />
          <Check ok={Boolean(settings.tmdbApiKey) || null} title={settings.tmdbApiKey ? "TMDB key saved" : "No TMDB key (search and posters are off)"} />
          <Check ok={settings.cnlEnabled || null} title={settings.cnlEnabled ? "Click'n'Load listener on port 9666" : "Click'n'Load is off"} />
          <Check
            ok={proxyUrlSetting() ? true : null}
            title={proxyUrlSetting() ? `Proxy set (${settings.proxyScope === "all" ? "everything" : "container sites only"})` : "No proxy; connecting directly"}
          />
          <Check ok={settings.flaresolverrUrl ? true : null} title={settings.flaresolverrUrl ? "FlareSolverr set" : "No FlareSolverr"} detail={settings.flaresolverrUrl || undefined} />
          <Check
            ok={settings.notifyWebhookUrl || settings.notifyAppriseUrl ? true : null}
            title={settings.notifyWebhookUrl || settings.notifyAppriseUrl ? "Notifications set up" : "No notifications"}
          />
        </ul>
      </section>

      <section className="card grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 p-4 text-sm md:p-5">
        <Info label="Config folder" mono>
          {configDir()}
        </Info>
        <Info label="Time zone">
          {timeZone()}{" "}
          <Link href="/settings/general" className="link text-xs">
            Change
          </Link>
        </Info>
        <Info label="Platform">
          {process.platform} {process.arch}
        </Info>
        <Info label="History">
          {counts.events.toLocaleString("en")} events{counts.firstEventAt ? ` since ${formatter({ day: "numeric", month: "short", year: "numeric" }).format(counts.firstEventAt)}` : ""}
        </Info>
      </section>
    </div>
  );
}

function Info({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className={`break-all text-fg ${mono ? "font-mono text-[13px]" : ""}`}>{children}</div>
    </div>
  );
}
