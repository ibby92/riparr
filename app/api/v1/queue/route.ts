import { api } from "@/lib/api";
import { activeLinks, recentlyFinishedLinks } from "@/lib/links";

export const GET = api(() => ({ active: activeLinks(), recent: recentlyFinishedLinks(50) }));
