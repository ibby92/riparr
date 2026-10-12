import { api, ApiError, idParam, jsonBody, parseTitleBody, sourceDto, titleDto } from "@/lib/api";
import { sendCommand } from "@/lib/commands";
import { listLinks } from "@/lib/links";
import { listSources } from "@/lib/sources";
import { logEvent } from "@/lib/events";
import { deleteTitle, getTitle, setTitleArchived, updateTitle } from "@/lib/titles";

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

/** Partial update: send only the fields to change. `archived: true|false` archives or brings it back. */
export const PATCH = api(async (req, ctx: Ctx) => {
  let title = load(await idParam(ctx));
  const { archived, ...body } = await jsonBody(req);
  if (typeof archived === "boolean" && archived !== (title.archived_at !== null)) {
    setTitleArchived(title.id, archived);
    sendCommand(archived ? { type: "cancel_title", titleId: title.id } : { type: "check_title", titleId: title.id });
    logEvent("info", `${archived ? "Archived" : "Brought back from the archive"}: ${title.name} (API)`, title.id, "web", {
      kind: archived ? "title_archived" : "title_unarchived",
    });
    title = load(title.id);
  }
  const input = parseTitleBody(body, {
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
  if (title.archived_at !== null) input.monitored = false;
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
