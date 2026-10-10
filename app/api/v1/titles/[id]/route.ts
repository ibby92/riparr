import { api, ApiError, idParam, jsonBody, parseTitleBody, sourceDto, titleDto } from "@/lib/api";
import { sendCommand } from "@/lib/commands";
import { listLinks } from "@/lib/links";
import { listSources } from "@/lib/sources";
import { deleteTitle, getTitle, updateTitle } from "@/lib/titles";

type Ctx = RouteContext<"/api/v1/titles/[id]">;

function load(id: number) {
  const title = getTitle(id);
  if (!title) throw new ApiError(404, "Title not found");
  return title;
}

export const GET = api(async (_req, ctx: Ctx) => {
  const title = load(await idParam(ctx));
  return { ...titleDto(title), sources: listSources(title.id).map(sourceDto), links: listLinks(title.id) };
});

/** Partial update: send only the fields to change. */
export const PATCH = api(async (req, ctx: Ctx) => {
  const title = load(await idParam(ctx));
  const input = parseTitleBody(await jsonBody(req), {
    type: title.type,
    name: title.name,
    year: title.year,
    tmdb_id: title.tmdb_id,
    overview: title.overview,
    poster_path: title.poster_path,
    total_episodes: title.total_episodes,
    root_folder_id: title.root_folder_id,
    folder: title.folder,
    season_folders: title.season_folders === 1,
    naming: title.naming,
    monitored: title.monitored === 1,
  });
  updateTitle(title.id, input);
  if (!input.monitored) sendCommand({ type: "cancel_title", titleId: title.id });
  return titleDto(getTitle(title.id)!);
});

/** Removes the title, its sources and history. Files on disk are kept. */
export const DELETE = api(async (_req, ctx: Ctx) => {
  const title = load(await idParam(ctx));
  deleteTitle(title.id);
  sendCommand({ type: "cancel_title", titleId: title.id });
  return new Response(null, { status: 204 });
});
