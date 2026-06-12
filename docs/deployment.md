# MiniChat — Deployment

MiniChat runs as a single Node server that also serves the built SPA, plus a
Docker daemon it uses to run one container per user for the agent workspace.

## Requirements

- **Linux host** (production). Dev works on macOS Docker Desktop.
- **Docker Engine** with the daemon reachable at `/var/run/docker.sock`. The
  server controls per-user containers via this socket (`dockerode`).
- **Node 20+** (the app image uses `node:20-alpine`; the workspace image uses
  `node:22-bookworm`).
- A reverse proxy (Caddy/nginx/Traefik) terminating TLS in front of the server.
- Disk for the SQLite DB (`data/`) and for per-user Docker volumes
  (`mc-ws-<userId>`, up to the per-user quota — default 10 GiB each).

## Docker socket: permissions and risk

The server needs read/write on the Docker socket to create, start, stop, exec,
and remove containers/volumes.

> **Security warning.** Access to the Docker socket is effectively **root on the
> host** — anything that can talk to the socket can start a privileged container
> and escape. Treat the MiniChat server process as a trusted, high-privilege
> component:
> - Run it on a host dedicated to this purpose (don't co-locate with unrelated
>   workloads).
> - Do not expose the server's admin surface to untrusted networks; front it
>   with TLS + the reverse proxy and bind the app to localhost
>   (`127.0.0.1:3001`, as in `docker-compose.yml`).
> - The per-user **workspace** containers do **not** get the socket mounted
>   inside them (ADR-001) — only the server has socket access.
> - Consider a socket proxy (e.g. `tecnativa/docker-socket-proxy`) restricting
>   the API surface if you want defense in depth.

On Linux the socket is typically owned by `root:docker`. Either run the server
as a user in the `docker` group, or (in compose) bind-mount the socket and run
appropriately. Granting `docker` group membership is also root-equivalent —
scope it deliberately.

## Build the workspace image

The per-user agent containers run a dedicated image (`deploy/workspace-image/`:
`node:22-bookworm` + git, gh, ripgrep, build-essential, and the Claude Code CLI
installed globally). Build it on the host before first use:

```bash
npm run build:workspace-image -w server
# equivalent to:
# docker build -t ${WORKSPACE_IMAGE:-minichat-workspace:latest} deploy/workspace-image
```

The server pulls the tag from `WORKSPACE_IMAGE` (default
`minichat-workspace:latest`). Rebuild + re-tag when you bump the CLI or tooling.

## Build & run the app

```bash
npm install
npm run build            # builds client (Vite) + server (tsc → server/dist)

# create the first admin
ADMIN_USERNAME=admin ADMIN_PASSWORD='…' npm run seed:admin -w server

NODE_ENV=production node server/dist/index.js
```

In production the server serves `client/dist` as the SPA and the API under
`/api`. The root `Dockerfile` does this as a multi-stage build → small Node
runtime image (see `docker-compose.yml`).

## Environment variables

Set these in `server/.env` (copy from `server/.env.example`). The server
fails fast at boot if a required var is missing (`lib/env.ts`).

### Required (Trinity proxy)
| Var | Notes |
|---|---|
| `TRINITY_OPENAI_URL` | e.g. `https://gate.trinity.tg/orion/v1` |
| `TRINITY_OPENAI_KEY` | OpenAI-side key (never sent to containers) |
| `TRINITY_ANTHROPIC_URL` | e.g. `https://gate.trinity.tg/aurora/v1` |
| `TRINITY_ANTHROPIC_KEY` | Anthropic-side key (never sent to containers) |

### Server config
| Var | Default | Notes |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `NODE_ENV` | — | `production` enables SPA serving, secure cookies, `trust proxy` |
| `CLIENT_ORIGIN` | `http://localhost:5173` | comma-separated allowed CORS origins; **required in production** |
| `SESSION_COOKIE_SECURE` | (prod→`1`) | `1` to force `Secure` cookies; defaults on in production |
| `DATA_DIR` | `./data` | SQLite directory |

### Claude Code Web (workspace/agent)
| Var | Default | Notes |
|---|---|---|
| `SECRETS_KEY` | — | **64 hex chars (32 bytes)**: `openssl rand -hex 32`. AES-256-GCM key for PATs. GitHub features degrade gracefully if unset (`hasSecretsKey()`). |
| `WORKSPACE_IMAGE` | `minichat-workspace:latest` | image tag for per-user containers |
| `WORKSPACE_IDLE_MINUTES` | `15` | idle-reaper stops containers idle longer than this |
| `AGENT_PROXY_BASE_URL` | `http://host.docker.internal:$PORT/api/agent-proxy` | how a container reaches the billing proxy; override on Linux if `host.docker.internal` isn't mapped |

> On Linux, containers reach the host via `extra_hosts: host.docker.internal:
> host-gateway` (set by `docker.ts` at container create). If your kernel/Docker
> version doesn't support `host-gateway`, set `AGENT_PROXY_BASE_URL` to the
> host's bridge IP (e.g. `http://172.17.0.1:3001/api/agent-proxy`).

## docker-compose

The repo ships a `docker-compose.yml` that builds the app image, binds the data
volume, **and mounts the Docker socket** so the server can manage workspace
containers:

```yaml
volumes:
  - ./data:/app/data
  - /var/run/docker.sock:/var/run/docker.sock   # ⚠️ root-equivalent; see above
```

Pass `SECRETS_KEY`, `WORKSPACE_IMAGE`, and `WORKSPACE_IDLE_MINUTES` through
`server/.env` (loaded via `env_file`). The app port is bound to `127.0.0.1` —
expose it through your reverse proxy, never directly.

Because the app runs in its own container but launches **sibling** workspace
containers on the host daemon, the workspace volumes live on the host. Build the
workspace image on the host (not inside the app container).

## Disk quota

Default enforcement is a **soft quota** (ADR-003): `du -sb /workspace` cached in
`workspaces.disk_used_bytes`, checked before agent runs and uploads; over-quota
blocks the action and the UI shows a banner. Admins are unlimited
(`disk_quota_bytes = NULL`). Admins can change any user's quota via
`PATCH /api/admin/workspaces/:userId`.

### Optional hard quota (XFS project quotas)

For a hard cap you can back the Docker volumes with an XFS filesystem mounted
with project quotas and assign a project per volume. This is **opt-in** and
host-specific:

1. Format/mount the Docker data or a dedicated volume path on XFS with
   `pquota`: `mount -o pquota /dev/sdX /var/lib/docker/volumes` (or a dedicated
   mount), and add it to `/etc/fstab`.
2. Assign a project id + limit per workspace directory:
   ```bash
   xfs_quota -x -c 'project -s -p /var/lib/docker/volumes/mc-ws-<id>/_data <projid>' /mount
   xfs_quota -x -c 'limit -p bhard=10g <projid>' /mount
   ```
3. Keep the soft quota on as well (the UI/agent gating still reads
   `disk_quota_bytes`).

This is not automated by the app; document it in your runbook if you enable it.

## Health & operations

- Health check: `GET /api/health` → `{ ok: true }` (used by the compose
  healthcheck).
- Expired sessions are reaped hourly; idle containers every 60s.
- Losing `SECRETS_KEY` makes stored PATs unrecoverable (users simply re-enter
  them). Key rotation requires manually re-encrypting `github_tokens` rows.
- Back up `data/minichat.db` (it's WAL — back up the `-wal`/`-shm` siblings too,
  or checkpoint first). Docker volumes hold user files; back them up separately
  if needed.
