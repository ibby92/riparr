import { api, ApiError, idParam } from "@/lib/api";
import { sendCommand } from "@/lib/commands";
import { getLink, setLinkStatus } from "@/lib/links";

export const POST = api(async (_req, ctx: RouteContext<"/api/v1/links/[id]/ignore">) => {
  const id = await idParam(ctx);
  if (!getLink(id)) throw new ApiError(404, "Link not found");
  setLinkStatus(id, "ignored");
  sendCommand({ type: "cancel_link", linkId: id });
  return { ok: true };
});
