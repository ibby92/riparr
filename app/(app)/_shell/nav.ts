import {
  Activity,
  ArrowDownToLine,
  Clapperboard,
  History,
  LayoutDashboard,
  MonitorCog,
  Settings,
  Tv,
  type LucideIcon,
} from "lucide-react";

/** Live counts the shell shows as badges (from /api/v1/status). */
export type BadgeKey = "attention" | "queue";

export type NavItem = { href: string; label: string; badge?: BadgeKey };
export type NavGroup = { id: string; label: string; icon: LucideIcon; items: NavItem[] };
export type NavEntry = { href: string; label: string; icon: LucideIcon } | NavGroup;

/** The whole app's navigation; routes here are the app's URLs. */
export const NAV: NavEntry[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  {
    id: "library",
    label: "Library",
    icon: Tv,
    items: [
      { href: "/shows", label: "Shows", badge: "attention" },
      { href: "/movies", label: "Movies" },
    ],
  },
  {
    id: "activity",
    label: "Activity",
    icon: Activity,
    items: [
      { href: "/queue", label: "Queue", badge: "queue" },
      { href: "/history", label: "History" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    items: [
      { href: "/settings/media", label: "Media Management" },
      { href: "/settings/downloads", label: "Downloads" },
      { href: "/settings/hosts", label: "Hosts" },
      { href: "/settings/connections", label: "Connections" },
      { href: "/settings/notifications", label: "Notifications" },
      { href: "/settings/security", label: "Security" },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: MonitorCog,
    items: [
      { href: "/system/status", label: "Status" },
      { href: "/system/backups", label: "Backups" },
    ],
  },
];

// Icons for nav items (groups use their own).
export const ITEM_ICONS: Record<string, LucideIcon> = {
  "/shows": Tv,
  "/movies": Clapperboard,
  "/queue": ArrowDownToLine,
  "/history": History,
};

export function isGroup(e: NavEntry): e is NavGroup {
  return "items" in e;
}

/** Whether `href` is the current page (or a page beneath it). */
export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
