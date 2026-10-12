import Link from "next/link";
import { connection } from "next/server";
import { Clapperboard, FolderPlus, LayoutGrid, List, Plus, SearchX, Tv } from "lucide-react";
import { listRootFolders } from "@/lib/root-folders";
import { listTitles, type TitleType, type TitleWithStats } from "@/lib/titles";
import { EmptyState, PageHeader, Poster, StatusPill, episodeLabel, formatAgo } from "../_kit";
import { allTitleProgress, siteOf, sourcesByTitle, type TitleProgress } from "../_data/progress";
import { FilterChip, SegLinks, SourceDot, TitleProgressBar, progressLabel, sourceTone, titlePill } from "./ui";

export type LibraryParams = { q?: string; status?: string; sort?: string; view?: string };

const FILTERS = [
  { key: "", label: "All" },
  { key: "ok", label: "Healthy" },
  { key: "attention", label: "Needs attention" },
  { key: "paused", label: "Paused" },
  { key: "archived", label: "Archived" },
] as const;

/** Archived titles only show under Archived, or in search results. */
function matches(t: TitleWithStats, status: string, searching = false) {
  if (status === "archived") return t.status === "archived";
  if (status === "attention") return t.status === "needs_attention" || t.status === "error";
  if (status === "paused") return t.status === "paused";
  if (status === "ok") return t.status === "ok" || t.status === "pending";
  return t.status !== "archived" || searching;
}

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export function readParams(sp: Record<string, string | string[] | undefined>): LibraryParams {
  return { q: one(sp.q)?.trim() || undefined, status: one(sp.status), sort: one(sp.sort), view: one(sp.view) };
}

function hrefWith(base: string, params: LibraryParams, change: Partial<LibraryParams>) {
  const merged = { ...params, ...change };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

const lastActivity = (t: TitleWithStats, p?: TitleProgress) => Math.max(p?.latest?.at ?? 0, t.last_changed_at ?? 0, t.updated_at);

/** Shows or Movies: poster grid or list, filtered by search params. */
export async function LibraryView({ type, searchParams }: { type: TitleType; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = readParams(await searchParams);
  await connection();
  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const base = type === "show" ? "/shows" : "/movies";
  const noun = type === "show" ? "show" : "movie";
  const plural = `${noun}s`;
  const Icon = type === "show" ? Tv : Clapperboard;

  const all = listTitles(type);
  const archived = all.filter((t) => t.archived_at !== null).length;
  const q = params.q?.toLowerCase();
  const searched = q ? all.filter((t) => t.name.toLowerCase().includes(q)) : all;
  const status = FILTERS.some((f) => f.key === params.status) ? (params.status ?? "") : "";
  const shown = searched.filter((t) => matches(t, status, Boolean(q)));
  const progress = allTitleProgress(shown, now);
  const sort = params.sort === "recent" ? "recent" : "name";
  if (sort === "recent") shown.sort((a, b) => lastActivity(b, progress.get(b.id)) - lastActivity(a, progress.get(a.id)));
  const view = params.view === "list" ? "list" : "grid";

  // The top-bar search lands on /shows; point to matching movies (or shows) too.
  const other = q ? listTitles(type === "show" ? "movie" : "show").filter((t) => t.name.toLowerCase().includes(q)).length : 0;

  const add = (
    <Link href="/titles/new" className="btn btn-primary">
      <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
      Add {noun}
    </Link>
  );
  const header = (
    <PageHeader
      title={type === "show" ? "Shows" : "Movies"}
      subtitle={
        all.length
          ? [
              `${all.length - archived} ${all.length - archived === 1 ? noun : plural}`,
              `${all.filter((t) => t.monitored).length} monitored`,
              archived ? `${archived} archived` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined
      }
      actions={add}
    />
  );

  if (all.length === 0) {
    const noRoots = listRootFolders().length === 0;
    return (
      <>
        {header}
        <div className="card">
          <EmptyState
            icon={noRoots ? FolderPlus : Icon}
            title={noRoots ? "Add a root folder first" : `No ${plural} yet`}
            body={
              noRoots
                ? "Riparr files downloads under a root folder, like /media/TV. Add one in Media Management, then add a title."
                : `Add a ${noun} and the pages that list its links. Riparr checks them and downloads what's new.`
            }
            action={
              noRoots ? (
                <Link href="/settings/media" className="btn btn-primary">
                  Open Media Management
                </Link>
              ) : (
                add
              )
            }
          />
        </div>
      </>
    );
  }

  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, searched.filter((t) => matches(t, f.key, Boolean(q))).length]));
  const sources = sourcesByTitle();

  return (
    <>
      {header}
      {q && (
        <div className="-mt-3 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span>
            Showing {plural} matching <b className="font-medium text-fg">“{params.q}”</b>
          </span>
          <Link href={hrefWith(base, params, { q: undefined })} className="link">
            Clear search
          </Link>
          {other > 0 && (
            <Link href={`${type === "show" ? "/movies" : "/shows"}?q=${encodeURIComponent(params.q ?? "")}`} className="link">
              {other} matching {type === "show" ? (other === 1 ? "movie" : "movies") : other === 1 ? "show" : "shows"}
            </Link>
          )}
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {FILTERS.filter((f) => f.key !== "archived" || archived > 0 || status === "archived").map((f) => (
            <FilterChip key={f.key} href={hrefWith(base, params, { status: f.key || undefined })} active={status === f.key} count={counts[f.key]}>
              {f.label}
            </FilterChip>
          ))}
        </div>
        <span className="flex-1" />
        <SegLinks
          label="Sort"
          items={[
            { href: hrefWith(base, params, { sort: undefined }), active: sort === "name", label: "Name" },
            { href: hrefWith(base, params, { sort: "recent" }), active: sort === "recent", label: "Recent" },
          ]}
        />
        <SegLinks
          label="View"
          items={[
            { href: hrefWith(base, params, { view: undefined }), active: view === "grid", label: "Poster grid", icon: LayoutGrid, iconOnly: true },
            { href: hrefWith(base, params, { view: "list" }), active: view === "list", label: "List", icon: List, iconOnly: true },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={SearchX}
            title={`No ${plural} match`}
            body={q ? `Nothing in your ${plural} matches this search and filter.` : "Nothing in your library has this status right now."}
            action={
              <Link href={base} className="btn">
                Show all {plural}
              </Link>
            }
          />
        </div>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-4 md:grid-cols-[repeat(auto-fill,minmax(158px,1fr))] md:gap-x-3.5 md:gap-y-[18px]">
          {shown.map((t) => {
            const p = progress.get(t.id)!;
            const pill = titlePill(t.status, t.type, p);
            return (
              <li key={t.id} className="min-w-0">
                <Link href={`/titles/${t.id}`} className="group flex flex-col gap-2 rounded-[10px]">
                  <div className="relative">
                    <Poster
                      id={t.id}
                      name={t.name}
                      year={t.year}
                      hasPoster={Boolean(t.tmdb_id && t.poster_path)}
                      className="w-full !rounded-[10px] shadow-sm transition-[transform,box-shadow] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md"
                    />
                    <span className="absolute right-2 top-2 z-10 max-w-[calc(100%-16px)] overflow-hidden rounded-pill bg-surface shadow-sm">
                      <StatusPill state={pill.state} label={pill.label} />
                    </span>
                  </div>
                  <h3 className="text-sm font-medium leading-snug text-fg [overflow-wrap:anywhere]">{t.name}</h3>
                  <TitleProgressBar type={t.type} progress={p} size="sm" />
                  <div className="flex justify-between gap-1.5 text-xs tabular-nums text-muted">
                    <span className="truncate">{progressLabel(t.type, p)}</span>
                    {t.year && <span>{t.year}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="card overflow-hidden">
          <div
            aria-hidden="true"
            className="hidden grid-cols-[minmax(0,2fr)_140px_minmax(140px,1fr)_minmax(0,1fr)_110px] gap-4 border-b border-border bg-surface-2 px-4 py-2.5 text-xs font-medium text-muted md:grid"
          >
            <span>Title</span>
            <span>Status</span>
            <span>{type === "show" ? "Episodes" : "Download"}</span>
            <span>Sources</span>
            <span>Latest</span>
          </div>
          <ul className="divide-y divide-border">
            {shown.map((t) => {
              const p = progress.get(t.id)!;
              const pill = titlePill(t.status, t.type, p);
              const latest = p.latest
                ? `${t.type === "show" ? (episodeLabel(p.latest.season, p.latest.episode) ?? "File") : "Downloaded"} · ${formatAgo(p.latest.at, now)}`
                : t.last_changed_at
                  ? `Links ${formatAgo(t.last_changed_at, now)}`
                  : "Nothing yet";
              const srcs = sources.get(t.id) ?? [];
              return (
                <li key={t.id} className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-3 hover:bg-surface-2 md:grid-cols-[minmax(0,2fr)_140px_minmax(140px,1fr)_minmax(0,1fr)_110px] md:items-center md:gap-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Poster id={t.id} name="" hasPoster={Boolean(t.tmdb_id && t.poster_path)} className="w-8 shrink-0 !rounded-xs" />
                    <div className="min-w-0">
                      {/* The whole row is the link's hit area (via the ::after overlay). */}
                      <Link href={`/titles/${t.id}`} className="font-medium text-fg after:absolute after:inset-0 hover:text-accent-ink">
                        {t.name}
                      </Link>
                      <div className="truncate text-xs text-muted">
                        {t.year ?? "Year unknown"} · <span className="font-mono">{t.root_path}/{t.folder}</span>
                      </div>
                    </div>
                  </div>
                  <div className="justify-self-end md:justify-self-start">
                    <StatusPill state={pill.state} label={pill.label} />
                  </div>
                  <div className="col-span-2 flex items-center gap-3 md:col-span-1 md:flex-col md:items-stretch md:gap-1">
                    <span className="w-16 shrink-0 text-xs text-muted md:hidden">{type === "show" ? "Episodes" : "Download"}</span>
                    <div className="flex min-w-0 max-w-[220px] flex-1 flex-col gap-1">
                      <span className="text-[13px] tabular-nums">{progressLabel(t.type, p)}</span>
                      <TitleProgressBar type={t.type} progress={p} size="sm" />
                    </div>
                  </div>
                  <div className="col-span-2 flex min-w-0 items-center gap-3 text-xs text-fg-2 md:col-span-1">
                    <span className="w-16 shrink-0 text-muted md:hidden">Sources</span>
                    {srcs.length ? (
                      <span className="flex min-w-0 flex-wrap gap-x-2.5 gap-y-1">
                        {srcs.map((s) => (
                          <SourceDot key={s.id} tone={sourceTone(s)} label={siteOf(s.url)} />
                        ))}
                      </span>
                    ) : (
                      <span className="text-muted">None</span>
                    )}
                  </div>
                  <div className="hidden text-xs tabular-nums text-muted md:block">{latest}</div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
