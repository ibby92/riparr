import { api, ApiError, idParam } from "@/lib/api";
import { sendCommand } from "@/lib/commands";
import { getTitle } from "@/lib/titles";

export const POST = api(async (_req, ctx: RouteContext<"/api/v1/titles/[id]/check">) => {
  const title = getTitle(await idParam(ctx));
  if (!title) throw new ApiError(404, "Title not found");
  if (!title.monitored) throw new ApiError(409, "Title is paused");
  sendCommand({ type: "check_title", titleId: title.id });
  return Response.json({ ok: true }, { status: 202 });
});
