import { api, ApiError, idParam } from "@/lib/api";
import { getLink, requeueLink } from "@/lib/links";

export const POST = api(async (_req, ctx: RouteContext<"/api/v1/links/[id]/retry">) => {
  const id = await idParam(ctx);
  if (!getLink(id)) throw new ApiError(404, "Link not found");
  requeueLink(id);
  return Response.json({ ok: true }, { status: 202 });
});
