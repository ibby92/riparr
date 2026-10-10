/** Needs a human: captcha, Cloudflare challenge, wrong password, login wall. */
export class NeedsAttentionError extends Error {
  name = "NeedsAttentionError";
}

/** The file or folder is gone from the host (404, deleted, taken down). Don't retry. */
export class HostOfflineError extends Error {
  name = "HostOfflineError";
}

/** The host asked us to slow down. Retry after `retryAfterMs`. */
export class RateLimitError extends Error {
  name = "RateLimitError";
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
  }
}

/** A transfer made no progress for too long. The partial is kept; retry soon (counts as an attempt). */
export class StallError extends Error {
  name = "StallError";
}
