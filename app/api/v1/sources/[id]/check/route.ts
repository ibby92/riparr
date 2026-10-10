import { api, ApiError, idParam } from "@/lib/api";
import { sendCommand } from "@/lib/commands";
import { getSource } from "@/lib/sources";

export const POST = api(async (_req, ctx: RouteContext<"/api/v1/sources/[id]/check">) => {
  const source = getSource(await idParam(ctx));
  if (!source) throw new ApiError(404, "Source not found");
  if (!source.enabled || !source.poll || !source.monitored) throw new ApiError(409, "Source is disabled, not polled, or its title is paused");
  sendCommand({ type: "check_now", sourceId: source.id });
  return Response.json({ ok: true }, { status: 202 });
});
