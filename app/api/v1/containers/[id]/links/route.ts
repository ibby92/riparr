import { z } from "zod";
import { api, ApiError, idParam, jsonBody } from "@/lib/api";
import { getContainer } from "@/lib/containers";
import { logEvent } from "@/lib/events";
import { addLinks } from "@/lib/links";

const body = z.object({
  urls: z.array(z.url({ protocol: /^https?$/ })).min(1).max(500),
});

/** Adds host links to a container by hand, as if its page had listed them. */
export const POST = api(async (req, ctx: RouteContext<"/api/v1/containers/[id]/links">) => {
  const container = getContainer(await idParam(ctx));
  if (!container) throw new ApiError(404, "Container not found");
  const { urls } = body.parse(await jsonBody(req));
  const added = addLinks(container.id, urls);
  logEvent("info", `API: added ${added} of ${urls.length} link(s)`, container.id);
  return Response.json({ received: urls.length, added }, { status: 201 });
});
