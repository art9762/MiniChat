# Multi-stage build: client (Vite) + server (TS) → single small Node image.

# ---------- 1. client build ----------
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---------- 2. server build ----------
FROM node:20-alpine AS server-build
WORKDIR /app/server
RUN apk add --no-cache python3 make g++  # for better-sqlite3 native build
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# ---------- 3. runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app

# Server prod deps only
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

# Compiled server + built client
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=client-build /app/client/dist ./client/dist

RUN mkdir -p /app/data && chown -R app:app /app
USER app

ENV DATA_DIR=/app/data PORT=3001
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/dist/index.js"]
