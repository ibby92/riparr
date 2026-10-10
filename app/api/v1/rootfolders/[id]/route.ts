import { api, ApiError, idParam } from "@/lib/api";
import { getRootFolder, removeRootFolder } from "@/lib/root-folders";

export const DELETE = api(async (_req, ctx: RouteContext<"/api/v1/rootfolders/[id]">) => {
  const id = await idParam(ctx);
  if (!getRootFolder(id)) throw new ApiError(404, "Root folder not found");
  if (!removeRootFolder(id)) throw new ApiError(409, "Titles still use this root folder; move or delete them first");
  return new Response(null, { status: 204 });
});
