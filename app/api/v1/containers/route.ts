import { api, ApiError, containerDto, jsonBody, parseContainerBody } from "@/lib/api";
import { sendCommand } from "@/lib/commands";
import { createContainer, findContainerByUrl, getContainer, listContainers } from "@/lib/containers";

export const GET = api(() => listContainers().map(containerDto));

export const POST = api(async (req) => {
  const input = parseContainerBody(await jsonBody(req));
  const existing = findContainerByUrl(input.url);
  if (existing) throw new ApiError(409, `Already watched as "${existing.name}"`, { id: existing.id });
  const id = createContainer(input);
  if (input.enabled && input.poll) sendCommand({ type: "check_now", containerId: id });
  return Response.json(containerDto(getContainer(id)!), { status: 201 });
});
