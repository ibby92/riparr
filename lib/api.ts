import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { authMode, SESSION_COOKIE, verifyApiKey, verifySessionToken } from "./auth";
import { containerInput, type Container } from "./containers";

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
    if (!authed) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const result = await handler(req, ctx);
      return result instanceof Response ? result : Response.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof ApiError) {
        return Response.json({ error: err.message, details: err.details }, { status: err.status });
      }
      if (err instanceof z.ZodError) {
        return Response.json({ error: "Invalid request", details: z.flattenError(err).fieldErrors }, { status: 400 });
      }
      console.error("[riparr] api error", err);
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

/** Public shape of a container: never includes the password. */
export function containerDto(c: Container & { link_count?: number; done_count?: number }) {
  const { password, ...rest } = c;
  return { ...rest, enabled: c.enabled === 1, poll: c.poll === 1, has_password: Boolean(password) };
}

/** Same fields as the UI form; booleans default to true, template to "{dir}/{filename}". */
export function parseContainerBody(body: Record<string, unknown>) {
  const str = (v: unknown, fallback = "") => (v === undefined || v === null ? fallback : String(v));
  return containerInput.parse({
    name: str(body.name),
    url: str(body.url),
    password: str(body.password),
    poll_interval_min: str(body.poll_interval_min, "60"),
    target_dir: str(body.target_dir),
    path_template: str(body.path_template, "{dir}/{filename}"),
    enabled: body.enabled === false ? undefined : "on",
    poll: body.poll === false ? undefined : "on",
  });
}
