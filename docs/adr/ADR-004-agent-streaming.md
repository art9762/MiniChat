# ADR-004: Streaming agent runs to the UI

Status: Accepted · Date: 2026-06-12

## Context

The chat path uses SSE for one-way token streaming. Agent runs are richer:
tool calls, tool results, status transitions, cancellation, and final
cost/usage. We want a bidirectional channel.

## Decision

Use a **WebSocket** at `GET /api/agent/ws?session=<id>` (the `ws` package,
upgraded on the same HTTP server as Express).

- **Auth on upgrade**: same `mc_sid` cookie as REST; reject the upgrade if the
  session is invalid, banned, or suspended, or if the session does not belong
  to the user.
- **Client → server**: `{type:"prompt", text, model?}` and `{type:"cancel"}`.
- **Server**: `ensureWorkspace` → balance/quota check → run
  `docker exec <container> claude -p <prompt> --output-format stream-json
  --verbose [--resume <cli_session_id>]` with cwd `/workspace`.
- Parse the CLI's **NDJSON** events and translate to typed
  `AgentServerMessage`s (`lib/agentTypes.ts`): `assistant_text`, `tool_use`,
  `tool_result`, `status`, `result`, `error`.
- Persist every event to `agent_events` for run history.
- On `result`, capture the CLI session id into `agent_sessions.cli_session_id`
  so the next prompt resumes the same session; the proxy's `usage_log` rows are
  the source of truth for billing (the CLI `total_cost_usd` is informational).
- `{type:"cancel"}` kills the exec process.

## Consequences

- One persistent connection per active agent session.
- Billing happens in the proxy (ADR-002), not the WS layer — the WS `result`
  message reports the already-settled cost/balance.
- NDJSON parsing must be resilient to partial lines and unknown event types
  (forward-compatible: ignore unknown `type`s).
