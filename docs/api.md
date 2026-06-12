# MiniChat — API Reference

All routes are under `/api`. Unless noted, request/response bodies are JSON.

**Auth model:** session is an httpOnly cookie `mc_sid` (30-day TTL). The browser
must send `credentials: "include"` on every request. Auth tiers:

- **public** — no session required.
- **auth** — valid session; `banned`/`suspended` users are rejected (403).
- **admin** — valid session with `role = "admin"`.
- **workspace token** — `agent-proxy` only: `x-api-key: wsk_…`, not a cookie.

Common error shape: `{ "error": "<message>" }` (the agent-proxy uses the
Anthropic error shape `{ "type": "error", "error": { "type", "message" } }`).
Mutating requests are additionally subject to a CSRF guard (`lib/csrf.ts`) and
SameSite=lax cookies.

---

## Auth — `/api/auth`

### POST `/api/auth/register` · public · rate-limited
Register with a one-time invite code.
- Body: `{ username, password, inviteCode }`
  - username: 3–32 chars `[a-zA-Z0-9_]`; password: 6–128 chars.
- 200: `{ user }` + sets `mc_sid` cookie.
- 400 invalid input / invalid-or-used invite · 409 username taken.

### POST `/api/auth/login` · public · rate-limited
- Body: `{ username, password }`
- 200: `{ user }` + cookie · 401 bad credentials · 403 banned.

### POST `/api/auth/logout` · public
Destroys the session and clears the cookie. 200: `{ ok: true }`.

### GET `/api/auth/me` · auth
- 200: `{ user }` (id, username, role, status, token_balance, created_at).

### POST `/api/auth/redeem` · auth · rate-limited
Redeem a `TKN-XXXX-XXXX` balance code.
- Body: `{ code }`
- 200: `{ ok: true, added, balance }` · 400 invalid/used code.

---

## Models & Chat — `/api`

### GET `/api/models` · auth
- 200: array of `{ id, name, provider, tier }` for chat models.

### POST `/api/chat` · auth · rate-limited (30/min/user)
Streaming chat completion (SSE).
- Body: `{ model, messages: [{role, content}], systemPrompt?, temperature? }`
  - 1–100 messages; roles `user|assistant|system`; total ≤ 200,000 chars.
- 402 if balance ≤ 0 (or insufficient for the pre-flight hold).
- 200: `text/event-stream`:
  - `data: {"content":"…"}` repeated for tokens,
  - `data: {"usage":{inputTokens,outputTokens,cost,balance}}` final,
  - `data: [DONE]`.
  - On upstream error: `data: {"error":"upstream_error","status":N}`.

### GET `/api/health` · public
- 200: `{ ok: true }`.

---

## Workspace — `/api/workspace` · auth

Strictly scoped to the authenticated user — no userId is accepted from the
client. Docker-down returns **503** `{ error: "docker unavailable" }`.

### GET `/api/workspace`
Status + disk usage + quota. Refreshes live disk usage when running.
- 200: `WorkspaceDTO` `{ status, diskUsedBytes, diskQuotaBytes (null=unlimited), lastActivityAt }`.

### POST `/api/workspace/start`
Ensure the volume + container exist and the container is running (cold start
creates/recreates it and mints a fresh workspace billing token).
- 200: `WorkspaceDTO` · 503 docker down · 500 start failed.

### POST `/api/workspace/stop`
Stop the container (volume + files persist).
- 200: `WorkspaceDTO`.

### POST `/api/workspace/reset`
**Destructive** — wipe the volume (deletes all files).
- Body: `{ confirm: true }` (required, else 400).
- 200: `WorkspaceDTO`.

---

## Agent sessions & runner — `/api/agent` · auth

> Implemented in Phase 2/4 (`routes/agent.ts`, `lib/agent.ts`). DTOs and the WS
> protocol are fixed in `lib/agentTypes.ts`.

### GET `/api/agent/sessions`
- 200: `{ sessions: AgentSessionDTO[] }` for the current user
  (`{ id, title, status, createdAt, updatedAt }`).

### POST `/api/agent/sessions`
Create a session.
- Body: `{ title? }`
- 200: `{ session: AgentSessionDTO }`.

### DELETE `/api/agent/sessions/:id`
Delete a session (must belong to the user; cascades `agent_events`).
- 200: `{ ok: true }` · 404 not found.

### WebSocket `GET /api/agent/ws?session=<id>`
Bidirectional agent run channel (`ws` package, upgraded on the HTTP server).
- **Auth on upgrade:** `mc_sid` cookie; the session must belong to the user and
  the user must be active. Invalid → upgrade rejected.
- **Client → server** (`AgentClientMessage`):
  - `{ "type":"prompt", "text": "...", "model"?: "claude-sonnet-4-6" }`
  - `{ "type":"cancel" }` — kills the running exec.
- **Server → client** (`AgentServerMessage`):
  - `{ "type":"status", "status":"starting|running|idle|error", "detail"? }`
  - `{ "type":"assistant_text", "text" }`
  - `{ "type":"tool_use", "id", "name", "input" }`
  - `{ "type":"tool_result", "id", "content", "isError"? }`
  - `{ "type":"result", "subtype"?, "costUnits", "balance", "inputTokens", "outputTokens", "durationMs"? }`
  - `{ "type":"error", "message", "code"? }`
- On prompt: `ensureWorkspace` → balance check (402-equivalent `error` if ≤ 0) →
  quota check → `docker exec claude -p … --output-format stream-json --verbose
  [--resume <cli_session_id>]`. Billing happens in the agent-proxy; the `result`
  message reports the already-settled cost/balance.

Allowed agent models (`AGENT_MODELS`): `claude-sonnet-4-6`, `claude-opus-4-7`,
`claude-haiku-4-5`.

---

## Agent billing proxy — `/api/agent-proxy` · workspace token

The Anthropic Messages API surface the in-container Claude Code CLI calls. **Not
cookie-authed.** Mounted before the global JSON body parser (payloads can be
large; uses its own 20 MB limit). See ADR-002.

### POST `/api/agent-proxy/v1/messages` · rate-limited (120/min/token)
- Headers: `x-api-key: wsk_…` (workspace token), plus passthrough of
  `anthropic-version` / `anthropic-beta`.
- Body: a standard Anthropic Messages request (`{ model, messages, system?,
  max_tokens?, stream? }`).
- Auth: bcrypt-compare the token against `workspaces.ws_token_hash`; resolve the
  owning user.
- 401 invalid key · 403 banned/suspended · 402 insufficient balance ·
  400 missing model · 502 upstream unreachable.
- On success: forwards verbatim to Trinity aurora `/messages` with the real key.
  Streaming (`stream:true`) is passed through byte-for-byte while usage is
  tee-parsed (`message_start`/`message_delta`); non-streaming returns the JSON
  as-is. Either way the user is billed and a `usage_log` row is written.

---

## Files — `/api/files` · auth · rate-limited (120/min/user)

> Implemented in Phase 3 (`routes/files.ts`). Every path is run through the
> path-traversal guard (`lib/wsPath.ts`) and refused if it escapes `/workspace`.
> All operations target the user's own container (scoped by `req.user.id`).

### GET `/api/files?path=<rel>`
Directory listing.
- 200: `{ entries: FileEntryDTO[] }` (`{ name, type:"file"|"dir", size, mtime }`).

### GET `/api/files/content?path=<rel>`
File contents (limit ~2 MB).
- 200: text content (or `{ content }`). · 413 too large · 415 binary.

### PUT `/api/files/content`
Write a file.
- Body: `{ path, content }`. · 200: `{ ok: true }`.

### POST `/api/files/mkdir` · `{ path }`
### POST `/api/files/rename` · `{ from, to }`
### POST `/api/files/delete` · `{ path }` (cannot target the workspace root)
- 200: `{ ok: true }`.

### POST `/api/files/upload` · multipart
`multipart/form-data` with file(s) + `path` field; written into the container.
- 200: `{ ok: true }`. · 413 over quota.

### GET `/api/files/download?path=<rel>`
Download a single file (streamed) or a directory / the whole workspace as a
`.zip` (tar from the container converted to zip via `archiver`).
- 200: file or `application/zip` stream.

### GET `/api/files/usage`
- 200: `{ diskUsedBytes, diskQuotaBytes }` (null quota = unlimited).

---

## GitHub — `/api/github` · auth

> Implemented in Phase 3 (`routes/github.ts`). Requires `SECRETS_KEY`. PAT is
> AES-256-GCM encrypted at rest and **never** returned by any endpoint
> (ADR-005).

### GET `/api/github`
Connection status.
- 200: `GithubStatusDTO` `{ connected, username, connectedAt }`.

### PUT `/api/github/token`
Save a Personal Access Token. Validated against `GET https://api.github.com/user`
before storing the ciphertext + resolved username.
- Body: `{ token }`
- 200: `{ connected: true, username }` · 400 invalid PAT · 503 no `SECRETS_KEY`.

### DELETE `/api/github/token`
Remove the stored PAT. 200: `{ ok: true }`.

### POST `/api/github/clone`
`git clone` into the workspace via the in-container credential helper.
- Body: `{ repoUrl, dir? }`
- 200: `{ ok: true }` (or run output) · 400 bad URL.

---

## Admin — `/api/admin` · admin

All routes require `role = "admin"` (`requireAdmin`). Mutations are written to
`admin_audit_log`. Guards prevent removing the last active admin.

### GET `/api/admin/stats`
- 200: `{ users, active, suspended, banned, invites_open, token_codes_open, total_spent, total_requests }`.

### GET `/api/admin/users`
- 200: `{ users: [ … , requests, spent ] }` (per-user usage_log counts).

### PATCH `/api/admin/users/:id`
- Body (any of): `{ status?, role?, token_balance?, addTokens? }`.
  - `token_balance` sets absolute; `addTokens` increments.
- 200: `{ user }` · 400 nothing to update / last-admin guard · 404 not found.

### DELETE `/api/admin/users/:id`
- 400 cannot delete self / last active admin · 404 not found · 200 `{ ok: true }`.

### Invites
- GET `/api/admin/invites` → `{ invites }` (with `used_by_username`).
- POST `/api/admin/invites` → `{ code }` (new `INV-XXXX-XXXX`).
- DELETE `/api/admin/invites/:code` → `{ ok: true }` · 400 if used/not found.

### Token codes
- GET `/api/admin/token-codes` → `{ codes }`.
- POST `/api/admin/token-codes` · `{ amount }` (positive int) → `{ code, amount }`.
- DELETE `/api/admin/token-codes/:code` → `{ ok: true }` · 400 if used/not found.

### Audit log
- GET `/api/admin/audit` → `{ entries }` (last 500, with `admin_username`).

### Workspaces (Phase 5)
- **GET `/api/admin/workspaces`** → `{ workspaces: [{ user_id, username,
  status, disk_used_bytes, disk_quota_bytes, last_activity_at, container_id }] }`.
  Read straight from the DB; does not require docker.
- **PATCH `/api/admin/workspaces/:userId`** · `{ quotaBytes? | quotaGB? }`
  (either as a number, or `null` for unlimited) → `{ workspace }`. Creates the
  workspace row if absent. 400 invalid input · 404 user not found.
- **POST `/api/admin/workspaces/:userId/stop`** → `{ ok: true }` · 503 docker
  down · 404 user not found.
- **POST `/api/admin/workspaces/:userId/delete`** · `{ wipeVolume? }` →
  `{ ok: true }`. `wipeVolume:true` also destroys the persistent volume (user's
  files). 503 docker down · 404 user not found.

### Agent runs (Phase 5)
- **GET `/api/admin/agent-runs`** → `{ runs: [{ user_id, username, sessions,
  runs, tokens, cost }] }`.
  > **Approximation:** `usage_log` does not distinguish agent vs chat traffic.
  > `sessions` is the exact `agent_sessions` count per user; `runs`/`tokens`/
  > `cost` are that user's **total** usage_log aggregates (chat + agent). Only
  > users with ≥ 1 agent session are listed.
