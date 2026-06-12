# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-12

The "Claude Code Web" release: MiniChat grows from a chat UI into a per-user
agent platform. Each user gets a persistent Docker workspace in which the Claude
Code CLI runs as an autonomous agent, with all token spend billed through a
server-side proxy.

### Added
- **Per-user workspaces** — on-demand, hardened Docker container
  (`mc-ws-<userId>`) + persistent named volume mounted at `/workspace`.
  Non-root, `no-new-privileges`, 2 GiB / 2 CPU / 512 pid limits, no docker
  socket inside. Idle-reaper auto-stops idle containers (`docker.ts`, ADR-001).
- **Agent runner** — `GET /api/agent/ws` WebSocket streams Claude Code CLI runs
  (`stream-json` NDJSON → typed `assistant_text` / `tool_use` / `tool_result` /
  `result` / `status` / `error`), with `--resume` session continuity and cancel.
  Agent sessions + event history persisted in `agent_sessions` / `agent_events`
  (ADR-004).
- **Agent billing proxy** — `POST /api/agent-proxy/v1/messages` presents an
  Anthropic Messages API surface to the in-container CLI, authenticates a scoped
  workspace token (bcrypt vs `ws_token_hash`), forwards to Trinity with the real
  key, captures usage, and bills the user. Trinity keys never enter a container
  (ADR-002).
- **Files API** — `/api/files` browse/read/write/mkdir/rename/delete/upload/
  download (single file or workspace `.zip`) over the container, with a
  path-traversal guard (`wsPath.ts`).
- **GitHub integration** — `/api/github` store an encrypted PAT (AES-256-GCM,
  ADR-005), connection status, and `clone` into the workspace via an in-container
  credential helper.
- **Disk quota** — soft 10 GiB per user (`du -sb` cached), checked before agent
  runs and uploads; admins unlimited (ADR-003).
- **Admin: workspaces** — `GET /api/admin/workspaces`, `PATCH
  /api/admin/workspaces/:userId` (set quota bytes/GB or unlimited), and
  `POST …/stop` / `POST …/delete` (optional volume wipe).
- **Admin: agent runs** — `GET /api/admin/agent-runs` aggregates sessions and
  usage per user.
- **UI redesign** — ChatGPT-style, true-black theme; new Agent run, Files, and
  GitHub settings views; workspace status chip.
- **New DB tables** — `workspaces`, `github_tokens`, `agent_sessions`,
  `agent_events` (created idempotently at boot in `lib/db.ts`).
- **Secrets** — `lib/crypto.ts` AES-256-GCM encryption (`SECRETS_KEY`) +
  opaque workspace-token minting.
- **Docs** — `docs/architecture.md`, `docs/api.md`, `docs/deployment.md`, and
  ADR-001..005 in `docs/adr/`.
- **Deploy** — workspace image (`deploy/workspace-image/Dockerfile`) +
  `build:workspace-image` npm script; docker-compose mounts the Docker socket;
  CI builds the workspace image; new env vars (`SECRETS_KEY`, `WORKSPACE_IMAGE`,
  `WORKSPACE_IDLE_MINUTES`, `AGENT_PROXY_BASE_URL`).

### Changed
- `usage_log` now records **both** chat and agent traffic (same hold→settle
  billing pattern); the agent-proxy is the source of truth for agent spend.
- Rate limiting extended to the agent proxy (per workspace token) and files API.

### Security
- Workspace billing tokens are bcrypt-hashed and never equal to Trinity keys.
- GitHub PATs are encrypted at rest and never returned by any endpoint.
- WebSocket upgrades are authenticated with the `mc_sid` cookie and scoped to
  the owning user; user-facing workspace/files/agent routes never accept a
  client-supplied userId (IDOR-safe).

### Baseline (prior to this release)
The auth + billing foundation this release builds on: invite-code registration
(`INV-XXXX-XXXX`), httpOnly cookie sessions, user roles/statuses, shared token
balance with per-model pricing (`pricing.ts`), token top-up codes
(`TKN-XXXX-XXXX`), SSE chat streaming via Trinity (OpenAI + Anthropic), the
admin panel (users / invites / token codes / stats / audit log), and security
hardening (helmet, CORS, rate limiting, CSRF guard).
