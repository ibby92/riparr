export type CrawlOptions = {
  password: string | null;
  signal: AbortSignal;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /**
   * FlareSolverr base URL (e.g. http://flaresolverr:8191). When set, pages behind a
   * Cloudflare/DDoS-Guard challenge are retried through it. Optional for backward compatibility.
   */
  flaresolverrUrl?: string | null;
};

export type CrawlResult = {
  /** Host links found in the container (gofile, pixeldrain, mega, …), deduplicated, in page order. */
  links: string[];
  /** Which source produced the links, e.g. "cnl2", "plain". Shown in the activity log. */
  source: string;
};

/**
 * Extracts host links from one kind of container page.
 *
 * `crawl` throws NeedsAttentionError (lib/errors.ts) for captchas, challenges
 * and wrong passwords, and returns null when the page isn't something this
 * source understands, so the next source can try.
 */
export interface ContainerSource {
  name: string;
  crawl(url: string, html: string, opts: CrawlOptions): Promise<CrawlResult | null>;
}
