import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (see Dockerfile).
  output: "standalone",
  // Pulled in via lib/hosts (pages import link helpers); load it from node_modules at runtime.
  serverExternalPackages: ["megajs"],
  // process.cwd()-relative paths in lib/db make the tracer pull in the whole
  // project; keep runtime data and sources out of the standalone bundle.
  outputFileTracingExcludes: {
    "/**": ["config/**", "downloads/**", "dist/**", "lib/**", "worker/**", "docker/**"],
  },
  cacheComponents: true,
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
