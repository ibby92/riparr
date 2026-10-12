import { api, ApiError, idParam, jsonBody, sourceDto } from "@/lib/api";
import { sendCommand } from "@/lib/commands";
import { deleteSource, findSourceByUrl, getSource, sourceInput, updateSource } from "@/lib/sources";

type Ctx = RouteContext<"/api/v1/sources/[id]">;

function load(id: number) {
  const source = getSource(id);
  if (!source) throw new ApiError(404, "Source not found");
  return source;
}

/** Partial update; a missing password keeps the saved one, "" clears it. */
export const PATCH = api(async (req, ctx: Ctx) => {
  const source = load(await idParam(ctx));
  const body = await jsonBody(req);
  const input = sourceInput.parse({
    url: source.url,
    password: source.password ?? "",
    poll_interval_min: source.poll_interval_min,
    enabled: source.enabled === 1,
    poll: source.poll === 1,
    ...body,
  });
  const taken = findSourceByUrl(input.url);
  if (taken && taken.id !== source.id) throw new ApiError(409, "That URL is already a source");
  const { urlChanged } = updateSource(source.id, input);
  if (urlChanged && source.monitored && input.enabled && input.poll) sendCommand({ type: "check_now", sourceId: source.id });
  return sourceDto(getSource(source.id)!);
});

/** Removes the source; links it found stay with the title. */
export const DELETE = api(async (_req, ctx: Ctx) => {
  deleteSource(load(await idParam(ctx)).id);
  return new Response(null, { status: 204 });
});
