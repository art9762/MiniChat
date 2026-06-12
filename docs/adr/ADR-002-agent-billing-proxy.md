# ADR-002: Agent billing proxy

Status: Accepted · Date: 2026-06-12

## Context

The Claude Code CLI runs inside the user's container and talks to "Anthropic".
We must (a) never put real Trinity keys in the container, and (b) bill every
token the agent spends against the user's shared `token_balance`, exactly like
the existing chat path.

## Decision

Point the CLI at our own server with a per-workspace scoped token:

```
ANTHROPIC_BASE_URL = http://host.docker.internal:3001/api/agent-proxy
ANTHROPIC_API_KEY  = <workspace token>   # opaque "wsk_..." token, NOT a Trinity key
```

`server/routes/agent-proxy.ts` implements the Anthropic Messages API surface
(`POST /api/agent-proxy/v1/messages`):

1. **Auth**: read `x-api-key` (the workspace token), hash-compare against
   `workspaces.ws_token_hash` (bcrypt). Resolve the owning user.
2. **Balance check**: 402 if the user's balance is ≤ 0. A pre-flight hold is
   placed (mirrors `routes/chat.ts`) and reconciled from real usage.
3. **Forward**: proxy the request body to Trinity aurora
   (`TRINITY_ANTHROPIC_URL/messages`) with the real `x-api-key`. Streaming is
   passed through verbatim to the CLI.
4. **Usage capture**: parse `message_start` / `message_delta` SSE events for
   `input_tokens` / `output_tokens`.
5. **Bill**: `calcCost(model, in, out)` using `pricing.ts`. The CLI sends full
   Anthropic model IDs, so `priceOf` falls back to a family-prefix price
   (opus/sonnet/haiku, ±1m) for unknown IDs.
6. **Record**: write `usage_log` with the agent's model and settle the hold.

To the CLI it looks exactly like Anthropic; billing is entirely ours and
Trinity keys never leave the server.

## Consequences

- One billing code path shared in spirit with `routes/chat.ts`.
- Rate limiting on the proxy is required (an agent can loop) — see
  `lib/rateLimit.ts` `agentProxyLimiter`.
- The proxy must be a faithful streaming passthrough (no buffering) so the CLI
  sees tokens promptly.
