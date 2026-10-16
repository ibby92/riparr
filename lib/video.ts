// Which files count as video (client-safe, no imports): what a folder scan records and what
// counts as an episode on disk.
const VIDEO_EXTS = ["mkv", "mp4", "m4v", "avi", "mov", "wmv", "ts", "m2ts", "webm", "flv", "mpg", "mpeg"];

export const VIDEO_EXTENSIONS = new RegExp(`\\.(${VIDEO_EXTS.join("|")})$`, "i");

export const isVideo = (filePath: string) => VIDEO_EXTENSIONS.test(filePath);

/** SQL condition: the path in `column` is a video file (same extensions as VIDEO_EXTENSIONS). */
export const isVideoSql = (column: string) => `(${VIDEO_EXTS.map((e) => `lower(${column}) LIKE '%.${e}'`).join(" OR ")})`;
