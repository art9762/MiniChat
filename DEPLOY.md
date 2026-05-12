# Deploy (small / friends-only)

## Prereqs
- Docker + docker-compose
- Reverse proxy with HTTPS (Caddy/nginx/traefik) — terminate TLS, forward to `127.0.0.1:3001`
- Trinity API credentials

## Steps

```bash
git clone <repo> && cd minichat
cp server/.env.example server/.env
# Edit server/.env: set CLIENT_ORIGIN, TRINITY_* keys
docker compose up -d --build
# Seed the first admin (interactive, one-time)
docker compose exec minichat node server/dist/scripts/seed-admin.js
```

Health: `GET /api/health` → `{"ok":true}`

## Caddy snippet

```
chat.example.com {
  reverse_proxy 127.0.0.1:3001
}
```

That's it. Caddy auto-issues certs. App enforces secure cookies (`SESSION_COOKIE_SECURE=1`), CORS only allows `CLIENT_ORIGIN`, helmet sets HSTS + X-Frame-Options + nosniff.

## Backups

SQLite DB lives at `./data/minichat.db`. Snapshot the `data/` directory periodically (e.g., daily `tar` + offsite, or `litestream` for continuous replication).

## Updating

```bash
git pull
docker compose up -d --build
```

DB migrations are `CREATE TABLE IF NOT EXISTS` — safe across restarts.
