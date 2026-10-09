import { api, ApiError, idParam } from "@/lib/api";
import { sendCommand } from "@/lib/commands";
import { getContainer } from "@/lib/containers";

export const POST = api(async (_req, ctx: RouteContext<"/api/v1/containers/[id]/check">) => {
  const container = getContainer(await idParam(ctx));
  if (!container) throw new ApiError(404, "Container not found");
  if (!container.enabled || !container.poll) throw new ApiError(409, "Container is paused or not polled");
  sendCommand({ type: "check_now", containerId: container.id });
  return Response.json({ ok: true }, { status: 202 });
});
