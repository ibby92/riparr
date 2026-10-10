import { z } from "zod";
import { api, ApiError, jsonBody, parseTitleBody, sourceDto, titleDto } from "@/lib/api";
import { sendCommand } from "@/lib/commands";
import { getRootFolder } from "@/lib/root-folders";
import { createSource, findSourceByUrl, listSources, sourceInput } from "@/lib/sources";
import { createTitle, findTitleByTmdb, getTitle, listTitles, type TitleType } from "@/lib/titles";

export const GET = api((req) => {
  const type = req.nextUrl.searchParams.get("type");
  return listTitles(type === "show" || type === "movie" ? (type as TitleType) : undefined).map(titleDto);
});

const sourcesBody = z.array(z.unknown()).max(20).default([]);

/** Creates a title, optionally with its sources: `{ name, type, ..., sources: [{ url, ... }] }`. */
export const POST = api(async (req) => {
  const body = await jsonBody(req);
  const input = parseTitleBody(body);
  if (!getRootFolder(input.root_folder_id)) throw new ApiError(400, "Root folder not found");
  if (input.tmdb_id) {
    const existing = findTitleByTmdb(input.type, input.tmdb_id);
    if (existing) throw new ApiError(409, `Already in the library as "${existing.name}"`, { id: existing.id });
  }
  const sources = sourcesBody.parse(body.sources).map((s) => sourceInput.parse(s));
  for (const s of sources) {
    const taken = findSourceByUrl(s.url);
    if (taken) throw new ApiError(409, `${s.url} is already a source of another title`, { title_id: taken.title_id });
  }

  const id = createTitle(input);
  for (const s of sources) createSource(id, s);
  if (input.monitored && sources.some((s) => s.enabled && s.poll)) sendCommand({ type: "check_title", titleId: id });
  return Response.json({ ...titleDto(getTitle(id)!), sources: listSources(id).map(sourceDto) }, { status: 201 });
});
