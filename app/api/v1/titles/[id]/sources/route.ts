import { api, ApiError, idParam, jsonBody, sourceDto } from "@/lib/api";
import { sendCommand } from "@/lib/commands";
import { createSource, findSourceByUrl, getSource, listSources, sourceInput } from "@/lib/sources";
import { getTitle } from "@/lib/titles";

type Ctx = RouteContext<"/api/v1/titles/[id]/sources">;

export const GET = api(async (_req, ctx: Ctx) => {
  const title = getTitle(await idParam(ctx));
  if (!title) throw new ApiError(404, "Title not found");
  return listSources(title.id).map(sourceDto);
});

export const POST = api(async (req, ctx: Ctx) => {
  const title = getTitle(await idParam(ctx));
  if (!title) throw new ApiError(404, "Title not found");
  const input = sourceInput.parse(await jsonBody(req));
  const taken = findSourceByUrl(input.url);
  if (taken) throw new ApiError(409, "That URL is already a source", { title_id: taken.title_id, id: taken.id });
  const id = createSource(title.id, input);
  if (title.monitored && input.enabled && input.poll) sendCommand({ type: "check_now", sourceId: id });
  return Response.json(sourceDto(getSource(id)!), { status: 201 });
});
