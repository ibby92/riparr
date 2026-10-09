# syntax=docker/dockerfile:1

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-slim
# p7zip-full (7-Zip 26 on bookworm) + p7zip-rar (non-free Rar.so codec) gives `7z` with RAR4/RAR5.
RUN sed -i 's/^Components: main$/Components: main non-free/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends gosu tini p7zip-full p7zip-rar \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=7676 \
    RIPARR_CONFIG_DIR=/config \
    RIPARR_DOWNLOADS_DIR=/downloads

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/dist/worker.mjs ./worker.mjs
COPY docker/entrypoint.sh /entrypoint.sh

VOLUME ["/config", "/downloads"]
# 7676: web UI. 9666: Click'n'Load listener (Phase 3).
EXPOSE 7676 9666
ENTRYPOINT ["tini", "--", "/entrypoint.sh"]
