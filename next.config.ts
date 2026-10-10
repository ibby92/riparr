import os from "node:os";
import type { NextConfig } from "next";

/**
 * `next dev` blocks its dev resources (HMR, dev chunks) for any host but localhost.
 * Allow this machine's own addresses, so the dev UI works when opened from another
 * device on the LAN, plus anything in RIPARR_DEV_ORIGINS (comma-separated hosts).
 * Only affects development; the production server ignores it.
 */
function devOrigins(): string[] {
  const own = Object.values(os.networkInterfaces())
    .flat()
    .flatMap((i) => (i ? [i.address] : []));
  const extra = (process.env.RIPARR_DEV_ORIGINS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return [...new Set([...own, os.hostname(), ...extra])];
}

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (see Dockerfile).
  output: "standalone",
  cacheComponents: true,
  allowedDevOrigins: devOrigins(),
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
