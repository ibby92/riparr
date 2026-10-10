import { api, ApiError } from "@/lib/api";
import { listDirectories } from "@/lib/root-folders";

/** Folders inside `?path=` (default "/"), for picking root folders. */
export const GET = api((req) => {
  try {
    return listDirectories(req.nextUrl.searchParams.get("path") || "/");
  } catch (err) {
    throw new ApiError(400, err instanceof Error ? err.message : String(err));
  }
});
