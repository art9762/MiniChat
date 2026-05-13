# Multi-stage build for npm workspaces (client + server) → single Node image.
# Debian slim base (glibc) so sharp's prebuilt binaries Just Work — no node-gyp.

# ---------- 1. install full workspace (with dev deps) for builds ----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
# build tools for better-sqlite3; sharp uses prebuilt binaries so no extra deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
# `npm install` (not `npm ci`) — tolerates package.json/lockfile drift after adding sharp.
RUN npm install --include=optional --no-audit --no-fund

# ---------- 2. build client + server ----------
FROM deps AS build
COPY client ./client
COPY server ./server
RUN npm run build

# ---------- 3. runtime: prod deps only ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r app && useradd -r -g app app

# Build tools needed only for better-sqlite3 prebuild during install; removed after.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json ./server/
# Install prod deps for the server workspace only (sharp pulls its prebuilt linux-x64/arm64 binaries).
RUN npm install --omit=dev --workspace server --include-workspace-root --include=optional --no-audit --no-fund \
 && npm cache clean --force \
 && apt-get purge -y python3 make g++ \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# Compiled server + built client SPA
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

RUN mkdir -p /app/data && chown -R app:app /app
USER app

ENV DATA_DIR=/app/data PORT=3001
EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/dist/index.js"]
