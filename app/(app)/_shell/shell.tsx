"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  ChevronDown,
  HardDrive,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
  X,
} from "lucide-react";
import { logout } from "@/app/auth-actions";
import { ITEM_ICONS, NAV, isActive, isGroup, type BadgeKey, type NavGroup } from "./nav";

/** The subset of /api/v1/status the shell uses. */
type Status = {
  /** The configured time zone (Settings → General). */
  time_zone?: string;
  worker: { online: boolean };
  titles: { needs_attention: number; error: number };
  links: { downloading: number; queued: number };
  speed_bps: number;
  hosts?: { host: string; label: string; state: "ok" | "limited" | "errors"; until: number | null; bytes_today: number }[];
  disk: { low: boolean; root_folders: { path: string; free_bytes: number | null; low: boolean }[] } | null;
};

function formatBytes(n: number | null | undefined) {
  if (n == null) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 || v >= 100 ? 0 : 1)} ${units[i]}`;
}

function readPref(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

/** Polls the status endpoint for badges and the sidebar status card. */
function useStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/v1/status", { cache: "no-store" });
        if (res.ok && !stop) setStatus(await res.json());
      } catch {}
    };
    void load();
    const id = setInterval(() => document.visibilityState === "visible" && void load(), 15_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);
  return status;
}

function badgeCount(status: Status | null, key: BadgeKey) {
  if (!status) return 0;
  return key === "attention"
    ? status.titles.needs_attention + status.titles.error
    : status.links.downloading + status.links.queued;
}

type Theme = "system" | "light" | "dark";

/** Sets or clears <html data-theme> (tokens.css follows the system when it's unset) and remembers the choice. */
function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  writePref("riparr-theme", t === "system" ? null : t);
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    const saved = readPref("riparr-theme");
    // Sync from storage after mount; the inline script already applied it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);
  const choose = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
  };
  const options: { value: Theme; label: string; Icon: typeof Sun }[] = [
    { value: "system", label: "System theme", Icon: Monitor },
    { value: "light", label: "Light theme", Icon: Sun },
    { value: "dark", label: "Dark theme", Icon: Moon },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-sm border border-border bg-surface p-0.5">
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => choose(value)}
          className={`grid size-8 place-items-center rounded-[6px] ${theme === value ? "bg-surface-3 text-fg" : "text-muted hover:text-fg"}`}
        >
          <Icon size={15} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}

function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="ml-auto min-w-5 rounded-pill bg-surface-3 px-1.5 text-center text-[11px] font-medium tabular-nums text-fg-2">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function Group({
  group,
  pathname,
  collapsed,
  status,
}: {
  group: NavGroup;
  pathname: string;
  collapsed: boolean;
  status: Status | null;
}) {
  const containsCurrent = group.items.some((i) => isActive(pathname, i.href));
  const [open, setOpen] = useState(containsCurrent || group.id === "library");
  const expanded = open || containsCurrent;
  const total = group.items.reduce((n, i) => n + (i.badge ? badgeCount(status, i.badge) : 0), 0);
  const Icon = group.icon;

  if (collapsed) {
    // Icon rail: the group icon links to its first page.
    return (
      <Link
        href={group.items[0].href}
        title={group.label}
        className={`relative grid h-10 place-items-center rounded-sm ${containsCurrent ? "bg-accent-soft text-accent-ink" : "text-muted hover:bg-surface-2 hover:text-fg"}`}
      >
        <Icon size={18} strokeWidth={1.75} />
        {total > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-critical" aria-label={`${total} need attention`} />}
      </Link>
    );
  }

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
        className="flex h-10 w-full items-center gap-3 rounded-sm px-3 text-left text-fg-2 hover:bg-surface-2"
      >
        <Icon size={18} strokeWidth={1.75} className={containsCurrent ? "text-accent" : "text-muted"} />
        <span className="font-medium">{group.label}</span>
        {!expanded && <Badge count={total} />}
        <ChevronDown size={15} className={`ml-auto text-faint transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <ul className="mb-1 ml-[22px] border-l border-border pl-2">
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            const ItemIcon = ITEM_ICONS[item.href];
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-[13.5px] ${active ? "bg-accent-soft font-medium text-accent-ink" : "text-fg-2 hover:bg-surface-2"}`}
                >
                  {ItemIcon && <ItemIcon size={15} strokeWidth={1.75} className={active ? "text-accent" : "text-faint"} />}
                  {item.label}
                  {item.badge && <Badge count={badgeCount(status, item.badge)} />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Sidebar({
  pathname,
  collapsed,
  status,
  onToggleCollapse,
  onClose,
}: {
  pathname: string;
  collapsed: boolean;
  status: Status | null;
  onToggleCollapse?: () => void;
  onClose?: () => void;
}) {
  const roots = status?.disk?.root_folders ?? [];
  return (
    <nav aria-label="Main" className="flex h-full flex-col bg-surface">
      <div className={`flex h-16 items-center border-b border-border ${collapsed ? "justify-center px-2" : "gap-3 px-4"}`}>
        <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="Riparr home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" width={32} height={32} className="size-8 shrink-0" />
          {!collapsed && <span className="font-display text-[22px] leading-none text-fg">Riparr</span>}
        </Link>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close menu" className="btn btn-ghost ml-auto size-9 p-0">
            <X size={18} />
          </button>
        )}
        {onToggleCollapse && !collapsed && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="ml-auto grid size-8 place-items-center rounded-sm text-faint hover:bg-surface-2 hover:text-fg"
          >
            <PanelLeftClose size={17} strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className={`flex-1 overflow-y-auto py-4 ${collapsed ? "px-2" : "px-3"}`}>
        {!collapsed && <p className="label-caps mb-2 px-3">Menu</p>}
        <div className="space-y-0.5">
          {NAV.map((entry) => {
            if (isGroup(entry)) {
              return <Group key={entry.id} group={entry} pathname={pathname} collapsed={collapsed} status={status} />;
            }
            const active = isActive(pathname, entry.href);
            const Icon = entry.icon;
            return (
              <Link
                key={entry.href}
                href={entry.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? entry.label : undefined}
                className={`flex h-10 items-center gap-3 rounded-sm ${collapsed ? "justify-center" : "px-3"} ${active ? "bg-accent-soft font-medium text-accent-ink" : "text-fg-2 hover:bg-surface-2"}`}
              >
                <Icon size={18} strokeWidth={1.75} className={active ? "text-accent" : "text-muted"} />
                {!collapsed && entry.label}
              </Link>
            );
          })}
        </div>
      </div>

      {collapsed ? (
        onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="mx-auto mb-3 grid size-9 place-items-center rounded-sm text-faint hover:bg-surface-2 hover:text-fg"
          >
            <PanelLeftOpen size={17} strokeWidth={1.75} />
          </button>
        )
      ) : (
        <div className="m-3 space-y-2 rounded-md border border-border bg-surface-2 p-3 text-xs">
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${status?.worker.online ? "bg-good" : "bg-critical"}`} />
            <span className="font-medium text-fg-2">{status ? (status.worker.online ? "Worker running" : "Worker offline") : "Checking…"}</span>
            {status && status.speed_bps > 0 && (
              <span className="ml-auto tabular-nums text-muted">{formatBytes(status.speed_bps)}/s</span>
            )}
          </div>
          {(status?.hosts ?? []).slice(0, 3).map((h) => (
            <div key={h.host} className="flex items-center gap-2 text-muted" title={h.state === "limited" ? "Limited by the host" : undefined}>
              <span
                className={`size-1.5 rounded-full ${h.state === "limited" ? "bg-warn" : h.state === "errors" ? "bg-critical" : "bg-good"}`}
                aria-hidden="true"
              />
              <span className="text-fg-2">{h.label}</span>
              <span className={`ml-auto tabular-nums ${h.state === "limited" ? "text-warn" : ""}`}>
                {h.state === "limited" && h.until
                  ? `until ${new Date(h.until).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: status?.time_zone })}`
                  : h.state === "errors"
                    ? "errors"
                    : `${formatBytes(h.bytes_today)} today`}
              </span>
            </div>
          ))}
          {roots.map((r) => (
            <div key={r.path} className="flex items-center gap-2 text-muted" title={r.path}>
              <HardDrive size={13} strokeWidth={1.75} className={r.low ? "text-warn" : ""} />
              <span className="min-w-0 truncate font-mono text-[11.5px]">{r.path}</span>
              <span className={`ml-auto shrink-0 tabular-nums ${r.low ? "font-medium text-warn" : ""}`}>{formatBytes(r.free_bytes)}</span>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}

function TopBar({ status, onMenu }: { status: Status | null; onMenu: () => void }) {
  const router = useRouter();
  const search = useRef<HTMLInputElement>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const attention = badgeCount(status, "attention");

  useEffect(() => {
    // "/" focuses search, as in the *arr apps.
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) && !target.isContentEditable) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header
      className="sticky z-20 flex h-16 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur md:px-7"
      style={{ top: "env(safe-area-inset-top, 0px)" }}
    >
      <button type="button" onClick={onMenu} aria-label="Open menu" className="btn btn-ghost size-9 p-0 md:hidden">
        <Menu size={19} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.svg" alt="" width={28} height={28} className="size-7 md:hidden" />

      <form
        role="search"
        className="relative hidden max-w-sm flex-1 md:block"
        onSubmit={(e) => {
          e.preventDefault();
          const q = search.current?.value.trim();
          router.push(q ? `/shows?q=${encodeURIComponent(q)}` : "/shows");
        }}
      >
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          ref={search}
          type="search"
          name="q"
          placeholder="Search titles…"
          aria-label="Search titles"
          className="input pl-9 pr-8"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-xs border border-border px-1.5 font-mono text-[11px] text-faint">
          /
        </kbd>
      </form>

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <div className="relative">
          <button
            type="button"
            onClick={() => setBellOpen((o) => !o)}
            aria-label={attention ? `${attention} title(s) need attention` : "Notifications"}
            aria-expanded={bellOpen}
            className="btn relative size-9 p-0"
          >
            <Bell size={17} strokeWidth={1.75} />
            {attention > 0 && (
              <span className="absolute -right-1 -top-1 min-w-4 rounded-pill bg-critical px-1 text-center text-[10px] font-semibold leading-4 text-primary-fg">
                {attention}
              </span>
            )}
          </button>
          {bellOpen && (
            <div className="absolute right-0 top-11 z-30 w-72 rounded-md border border-border bg-surface p-3 text-sm shadow-md">
              {attention ? (
                <>
                  <p className="font-medium">
                    {attention} title{attention === 1 ? "" : "s"} need{attention === 1 ? "s" : ""} attention
                  </p>
                  <p className="mt-1 text-muted">A source needs a person: a captcha, a password, or a page that&apos;s gone.</p>
                  <Link href="/shows?status=attention" onClick={() => setBellOpen(false)} className="link mt-2 inline-block">
                    Show them
                  </Link>
                </>
              ) : (
                <p className="text-muted">Nothing needs your attention.</p>
              )}
            </div>
          )}
        </div>
        <form action={logout} className="hidden md:block">
          <button className="btn btn-ghost size-9 p-0" aria-label="Sign out" title="Sign out">
            <LogOut size={17} strokeWidth={1.75} />
          </button>
        </form>
      </div>
    </header>
  );
}

function PathnameReader({ children }: { children: (pathname: string) => React.ReactNode }) {
  return children(usePathname());
}

/**
 * Renders `children` with the current path. The path is request-time data on
 * dynamic routes, so it must sit inside Suspense; until it's known the nav
 * renders with nothing highlighted.
 */
function WithPathname({ children }: { children: (pathname: string) => React.ReactNode }) {
  return (
    <Suspense fallback={children("")}>
      <PathnameReader>{children}</PathnameReader>
    </Suspense>
  );
}

/** Closes the drawer whenever the path changes. */
function CloseOnNavigate({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  useEffect(() => onNavigate(), [pathname, onNavigate]);
  return null;
}

/** Sidebar + top bar around every signed-in page. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const status = useStatus();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(readPref("riparr-sidebar") === "collapsed");
  }, []);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const closeDrawer = useCallback(() => setDrawer(false), []);
  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => {
      writePref("riparr-sidebar", c ? null : "collapsed");
      return !c;
    });
  }, []);

  return (
    <div className="flex min-h-full">
      <Suspense fallback={null}>
        <CloseOnNavigate onNavigate={closeDrawer} />
      </Suspense>
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 border-r border-border md:block ${collapsed ? "w-[68px]" : "w-[264px]"}`}
      >
        <WithPathname>
          {(pathname) => <Sidebar pathname={pathname} collapsed={collapsed} status={status} onToggleCollapse={toggleCollapse} />}
        </WithPathname>
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-overlay" onClick={() => setDrawer(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 w-[min(300px,85vw)] shadow-lg">
            <WithPathname>
              {(pathname) => <Sidebar pathname={pathname} collapsed={false} status={status} onClose={() => setDrawer(false)} />}
            </WithPathname>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar status={status} onMenu={() => setDrawer(true)} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-7">{children}</main>
      </div>
    </div>
  );
}
