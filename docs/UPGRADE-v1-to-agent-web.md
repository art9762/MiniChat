# Upgrade runbook: v1 → Agent Web (v1.0.0)

This is the **operational guide for upgrading the already-running production
server** (the one at `82.26.152.98`, deployed via `.github/workflows/deploy.yml`)
from the current v1 to the "Claude Code Web" release.

It is intentionally specific to the live deployment. For a fresh install see
[`docs/deployment.md`](./deployment.md); for the day-to-day deploy flow see
[`DEPLOY.md`](../DEPLOY.md).

---

## What changes for ops (read first)

This release turns the server into an **agent platform** that launches one
Docker container per user. That introduces three new operational facts:

1. **The server now needs the Docker socket.** `docker-compose.yml` mounts
   `/var/run/docker.sock` into the app container. This is **root-equivalent on
   the host** — see the security note below. Without it, the app boots fine but
   every `/api/workspace`, `/api/agent`, `/api/files`, `/api/github` call
   returns `503` (the routes degrade gracefully; chat keeps working).
2. **A new image must be built on the host:** `minichat-workspace:latest`. The
   auto-deploy pipeline does **not** build it — you build it once by hand (and
   again when you bump the agent toolchain). Until it exists, starting an agent
   fails.
3. **A new secret is required for GitHub features:** `SECRETS_KEY` in
   `server/.env`. If unset, the app still runs; only the GitHub PAT/clone
   features are disabled (they return `503 "secrets key not configured"`).

The DB migrates itself — all new tables are `CREATE TABLE IF NOT EXISTS`, run at
boot. No manual migration, no downtime for the schema. Existing users, balances,
sessions, invite/token codes, and the Projects feature are untouched.

> ⚠️ **Docker socket = root on the host.** Anything that can talk to the socket
> can start a privileged container and escape to the host. The MiniChat server
> is now a high-privilege component. Keep it on a dedicated host, keep the app
> bound to `127.0.0.1:3001` behind your reverse proxy (it already is), and never
> expose the admin surface publicly. Per-user workspace containers do **not**
> receive the socket (ADR-001). Optionally front the socket with
> `tecnativa/docker-socket-proxy` for defense in depth.

---

## Pre-flight (do BEFORE the code lands)

The production `deploy.yml` triggers on **every push to `main`**: it SSHes in,
`git reset --hard`, and `docker compose up -d --build`. So if you merge this
release to `main`, it deploys immediately. Prepare the host **first** so the new
code has what it needs on the very first boot.

SSH to the prod host and, in the deploy directory (`$DEPLOY_PATH`):

```bash
# 1. Generate and set the secrets key (32 bytes / 64 hex chars).
openssl rand -hex 32
# → copy the output, then add to server/.env:
#   SECRETS_KEY=<that value>
#   (optional, has sane defaults:)
#   WORKSPACE_IMAGE=minichat-workspace:latest
#   WORKSPACE_IDLE_MINUTES=15
$EDITOR server/.env

# 2. Confirm the deploy user can use Docker (the compose mount needs the socket).
docker ps >/dev/null && echo "docker OK"
# If "permission denied": add the deploy user to the docker group, re-login:
#   sudo usermod -aG docker $USER     # root-equivalent; deliberate choice
```

> If you keep `SECRETS_KEY` only in `server/.env` (loaded via compose
> `env_file`), that's enough. The compose file also passes
> `SECRETS_KEY`/`WORKSPACE_IMAGE`/`WORKSPACE_IDLE_MINUTES` through from the shell
> environment if set — `server/.env` is the simplest single source of truth.

---

## Deploy

You have two options.

### Option A — let the pipeline deploy (merge to main)

1. Merge the `feat/agent-web` PR into `main`.
2. The `Deploy` workflow runs automatically: `git reset --hard`, `docker compose
   up -d --build`. The app image rebuilds (client SPA + server) and restarts.
3. The workflow's healthcheck polls `/api/health` until `200`.
4. **Immediately after**, build the workspace image on the host (the pipeline
   doesn't):

   ```bash
   cd $DEPLOY_PATH
   npm run build:workspace-image -w server
   # → docker build -t minichat-workspace:latest deploy/workspace-image
   ```

   Chat works without it; agent runs need it.

### Option B — manual, controlled (recommended for the first time)

Do it by hand so you can verify each step and avoid a half-ready agent feature
going live the instant CI runs:

```bash
cd $DEPLOY_PATH
git fetch --prune origin
git checkout -f main && git reset --hard origin/main   # after the PR is merged

# Build the workspace image FIRST (so agent works the moment the app is up)
npm run build:workspace-image -w server

# Rebuild + restart the app (picks up the new docker.sock mount from compose)
docker compose up -d --build

# Verify
curl -fsS https://82-26-152-98.sslip.io/api/health   # → {"ok":true}
```

---

## Post-deploy verification

```bash
# App up
curl -fsS https://<your-host>/api/health           # {"ok":true}

# Workspace image present
docker image ls | grep minichat-workspace

# App container has the socket (workspace mgmt works, not 503)
docker compose exec minichat sh -c 'ls -l /var/run/docker.sock'
```

Then in the UI, as an admin:
1. Switch to **Agent** mode → the workspace container auto-starts (first run
   pulls/creates `mc-ws-<userId>`; cold start takes a few seconds).
2. Send a prompt → you should see streamed assistant text + tool cards, and your
   balance should tick down (billed through the agent proxy).
3. **Files** panel lists `/workspace`; **Settings → GitHub** accepts a PAT (only
   if `SECRETS_KEY` is set).
4. **Admin → Workspaces** lists the running container with disk usage.

If agent runs fail with `503 workspace runtime unavailable`: the app can't reach
the Docker socket — re-check the mount and the deploy user's docker group.

If GitHub save returns `503 secrets key not configured`: `SECRETS_KEY` is missing
or not 64 hex chars in `server/.env`; set it and `docker compose up -d` again.

---

## Rollback

The release is additive and reversible:

```bash
cd $DEPLOY_PATH
git reset --hard <previous-good-sha>   # the v1 commit, e.g. before the merge
docker compose up -d --build
```

The new tables remain in the DB but are simply unused by the old code (harmless).
User data, balances, and Projects are unaffected. You can leave the
`minichat-workspace` image and the `mc-ws-*` volumes in place, or prune them:

```bash
# only if fully abandoning the feature:
docker ps -aq --filter label=minichat.user | xargs -r docker rm -f
docker volume ls -q --filter name=mc-ws- | xargs -r docker volume rm
docker image rm minichat-workspace:latest
```

---

## Resource planning

- Each active user = one container (2 GiB / 2 CPU / 512 pids cap) + a persistent
  volume (soft 10 GiB quota; admins unlimited). Idle containers auto-stop after
  `WORKSPACE_IDLE_MINUTES` (default 15) but **volumes persist**.
- Size the host for `peak concurrent agents × 2 GiB` RAM plus headroom for the
  app + Docker, and disk for `users × typical-workspace-size`.
- Watch volume growth: `docker system df -v`. Quotas are soft by default; see
  `docs/deployment.md` for optional XFS hard quotas.

---

## New env vars (summary)

| Var | Required? | Default | Purpose |
|---|---|---|---|
| `SECRETS_KEY` | for GitHub features | — | `openssl rand -hex 32`; AES-256-GCM key for PATs |
| `WORKSPACE_IMAGE` | no | `minichat-workspace:latest` | per-user container image tag |
| `WORKSPACE_IDLE_MINUTES` | no | `15` | idle-stop threshold |
| `AGENT_PROXY_BASE_URL` | no | `http://host.docker.internal:$PORT/api/agent-proxy` | override only if `host-gateway` isn't supported |

Existing v1 vars (`TRINITY_*`, `CLIENT_ORIGIN`, `SESSION_COOKIE_SECURE`, `PORT`,
`DATA_DIR`) are unchanged.
