import Link from "next/link";
import type { SourceWithTitle } from "@/lib/sources";
import type { TitleWithStats } from "@/lib/titles";
import { Poster, StatusPill, Tag, episodeLabel, formatAgo } from "../_kit";
import { siteOf, type TitleProgress } from "../_data/progress";
import { Note, SourceDot, TitleProgressBar, progressLabel, sourceTone, titlePill, titleReason } from "./ui";

/** Dashboard title card: poster, state, episode progress, reason, latest episode and source health. */
export function TitleCard({
  title: t,
  progress: p,
  sources,
  now,
}: {
  title: TitleWithStats;
  progress: TitleProgress;
  sources: SourceWithTitle[];
  now: number;
}) {
  const pill = titlePill(t.status, t.type, p);
  const reason = titleReason(t, p, now);
  const pct = p.total ? Math.round(((p.done + (t.type === "movie" ? p.downloading : 0)) / p.total) * 100) : 0;
  const latest = p.latest
    ? `${t.type === "show" ? (episodeLabel(p.latest.season, p.latest.episode) ?? "File") : "Downloaded"} · ${formatAgo(p.latest.at, now)}`
    : t.last_changed_at
      ? `New links ${formatAgo(t.last_changed_at, now)}`
      : t.last_checked_at
        ? `Checked ${formatAgo(t.last_checked_at, now)}`
        : "Not checked yet";
  return (
    <Link
      href={`/titles/${t.id}`}
      className="card grid grid-cols-[64px_minmax(0,1fr)] gap-3.5 p-3.5 transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-sm md:grid-cols-[76px_minmax(0,1fr)]"
    >
      <Poster id={t.id} name={t.name} year={t.year} hasPoster={Boolean(t.tmdb_id && t.poster_path)} />
      <div className="flex min-w-0 flex-col gap-2">
        <div>
          <h3 className="font-display text-[17px] font-medium leading-tight text-fg [overflow-wrap:anywhere]">{t.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <Tag>{t.type === "movie" ? "Movie" : "Show"}</Tag>
            {t.year && <span className="tabular-nums">{t.year}</span>}
          </div>
        </div>
        <div>
          <StatusPill state={pill.state} label={pill.label} />
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between gap-2 text-[13px]">
            <span className="font-medium tabular-nums text-fg">{progressLabel(t.type, p)}</span>
            {p.total > 0 && <span className="tabular-nums text-muted">{pct}%</span>}
          </div>
          <TitleProgressBar type={t.type} progress={p} />
        </div>
        {reason && (
          <Note tone={reason.tone}>
            <span className="line-clamp-1">{reason.text}</span>
          </Note>
        )}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
          <span className="tabular-nums">{latest}</span>
          {sources.length > 0 && (
            <span className="flex min-w-0 flex-wrap gap-x-2.5 gap-y-1">
              {sources.map((s) => (
                <SourceDot key={s.id} tone={sourceTone(s)} label={siteOf(s.url).split(".")[0]} />
              ))}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
