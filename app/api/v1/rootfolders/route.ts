import { z } from "zod";
import { api, ApiError, jsonBody } from "@/lib/api";
import { addRootFolder, listRootFolders, normalizeRootPath, rootFolderError } from "@/lib/root-folders";

export const GET = api(() => listRootFolders());

export const POST = api(async (req) => {
  const { path } = z.object({ path: z.string().trim().min(1) }).parse(await jsonBody(req));
  const normalized = normalizeRootPath(path);
  const error = rootFolderError(normalized);
  if (error) throw new ApiError(400, error);
  const id = addRootFolder(normalized);
  return Response.json(listRootFolders().find((r) => r.id === id), { status: 201 });
});
