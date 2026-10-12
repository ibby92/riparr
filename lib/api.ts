import { connection, type NextRequest } from "next/server";
import { logDebug, logEvent } from "./events";
import { z } from "zod";
import { authMode, SESSION_COOKIE, verifyApiKey, verifySessionToken } from "./auth";
import { listRootFolders } from "./root-folders";
import { getSettings } from "./settings";
import type { Source, SourceWithTitle } from "./sources";
import { defaultFolder, titleInput, type TitleInput, type TitleType, type TitleWithStats } from "./titles";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<unknown> | unknown;

/**
 * Wraps a v1 route handler: request-time only, authenticated (the proxy checks
 * too; this keeps handlers safe if the matcher ever misses a route), JSON in/out.
 */
export function api<C>(handler: Handler<C>) {
  return async (req: NextRequest, ctx: C) => {
    await connection();
    const authed =
      authMode() === "none" ||
      verifyApiKey(req.headers.get("x-api-key") ?? req.nextUrl.searchParams.get("apikey")) ||
      verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value) !== null;
    if (!authed) {
      logDebug("web", `API ${req.method} ${req.nextUrl.pathname} refused: not signed in and no valid API key`);
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const result = await handler(req, ctx);
      return result instanceof Response ? result : Response.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status >= 500) logEvent("error", `API ${req.method} ${req.nextUrl.pathname}: ${err.message}`, null, "web");
        else logDebug("web", `API ${req.method} ${req.nextUrl.pathname} → ${err.status} ${err.message}`);
        return Response.json({ error: err.message, details: err.details }, { status: err.status });
      }
      if (err instanceof z.ZodError) {
        return Response.json({ error: "Invalid request", details: z.flattenError(err).fieldErrors }, { status: 400 });
      }
      logEvent("error", `API ${req.method} ${req.nextUrl.pathname} failed: ${err instanceof Error ? err.message : String(err)}`, null, "web");
      if (err instanceof Error && err.stack) logDebug("web", `Stack: ${err.stack}`);
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

export async function jsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {}
  throw new ApiError(400, "Body must be a JSON object");
}

export async function idParam(ctx: { params: Promise<{ id: string }> }): Promise<number> {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid id");
  return id;
}

/** Public shape of a source: never includes the password. */
export function sourceDto(s: Source & Partial<Pick<SourceWithTitle, "title_name" | "link_count">>) {
  const { password, ...rest } = s;
  return { ...rest, enabled: s.enabled === 1, poll: s.poll === 1, has_password: Boolean(password) };
}

/** Public shape of a title. */
export function titleDto(t: TitleWithStats) {
  return { ...t, season_folders: t.season_folders === 1, monitored: t.monitored === 1, archived: t.archived_at !== null };
}

/**
 * Title fields from a JSON body, with defaults: the default root folder for the
 * type, a folder named after the title, and season folders per Media Management.
 */
export function parseTitleBody(body: Record<string, unknown>, existing?: TitleInput) {
  const settings = getSettings();
  const type = (body.type ?? existing?.type ?? "show") as TitleType;
  const roots = listRootFolders();
  const defaultRoot =
    roots.find((r) => r.id === (type === "movie" ? settings.defaultMovieRootId : settings.defaultShowRootId)) ?? roots[0];
  const merged = { ...existing, ...body, type };
  const name = String(merged.name ?? "");
  const rawYear: unknown = merged.year;
  const year = rawYear === undefined || rawYear === null || rawYear === "" ? null : Number(rawYear);
  return titleInput.parse({
    ...merged,
    root_folder_id: merged.root_folder_id ?? defaultRoot?.id,
    folder: merged.folder ?? (name ? defaultFolder(name, type, Number.isFinite(year) ? year : null) : ""),
    season_folders: merged.season_folders ?? settings.defaultSeasonFolders,
    naming: merged.naming ?? "{filename}",
    monitored: merged.monitored ?? true,
  });
}
