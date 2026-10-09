import { api, ApiError, containerDto, idParam } from "@/lib/api";
import { sendCommand } from "@/lib/commands";
import { deleteContainer, getContainer } from "@/lib/containers";
import { listLinks } from "@/lib/links";

type Ctx = RouteContext<"/api/v1/containers/[id]">;

export const GET = api(async (_req, ctx: Ctx) => {
  const container = getContainer(await idParam(ctx));
  if (!container) throw new ApiError(404, "Container not found");
  return { ...containerDto(container), links: listLinks(container.id) };
});

export const DELETE = api(async (_req, ctx: Ctx) => {
  const id = await idParam(ctx);
  if (!getContainer(id)) throw new ApiError(404, "Container not found");
  deleteContainer(id);
  sendCommand({ type: "cancel_container", containerId: id });
  return new Response(null, { status: 204 });
});
