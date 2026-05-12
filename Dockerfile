# Multi-stage build for npm workspaces (client + server) → single small Node image.

# ---------- 1. install full workspace (with dev deps) for builds ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++  # for better-sqlite3 native build
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN npm ci

# ---------- 2. build client + server ----------
FROM deps AS build
COPY client ./client
COPY server ./server
RUN npm run build

# ---------- 3. runtime: prod deps only ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 make g++ tini \
 && addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json ./
COPY server/package.json ./server/
# Install prod deps for the server workspace only (rebuilds better-sqlite3 natively).
RUN npm ci --omit=dev --workspace server --include-workspace-root \
 && npm cache clean --force \
 && apk del python3 make g++

# Compiled server + built client SPA
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

RUN mkdir -p /app/data && chown -R app:app /app
USER app

ENV DATA_DIR=/app/data PORT=3001
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/dist/index.js"]
