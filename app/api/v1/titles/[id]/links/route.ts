import { z } from "zod";
import { api, ApiError, idParam, jsonBody } from "@/lib/api";
import { logEvent } from "@/lib/events";
import { addLinks } from "@/lib/links";
import { getTitle } from "@/lib/titles";

const body = z.object({
  urls: z.array(z.url({ protocol: /^https?$/ })).min(1).max(500),
  archive_password: z.string().trim().optional(),
});

/** Adds host links to a title by hand, as if one of its sources had listed them. */
export const POST = api(async (req, ctx: RouteContext<"/api/v1/titles/[id]/links">) => {
  const title = getTitle(await idParam(ctx));
  if (!title) throw new ApiError(404, "Title not found");
  const { urls, archive_password } = body.parse(await jsonBody(req));
  const added = addLinks(title.id, null, urls, archive_password || null);
  logEvent("info", `API: added ${added} of ${urls.length} link(s)`, title.id);
  return Response.json({ received: urls.length, added }, { status: 201 });
});
