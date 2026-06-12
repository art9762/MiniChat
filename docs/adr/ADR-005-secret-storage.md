# ADR-005: Secret storage (AES-256-GCM)

Status: Accepted · Date: 2026-06-12

## Context

We store GitHub Personal Access Tokens (and could store other per-user
secrets). These must be encrypted at rest and never returned to the client
after being saved.

## Decision

Symmetric **AES-256-GCM** (`server/lib/crypto.ts`).

- Key: `SECRETS_KEY` in `server/.env` — **32 bytes as 64 hex chars**. Validated
  at use; features that need it degrade gracefully (`hasSecretsKey()`).
- Stored format: `iv:tag:ciphertext`, all hex. 96-bit random IV per encryption,
  GCM auth tag verified on decrypt (tamper-evident).
- `encryptSecret(plaintext)` / `decryptSecret(stored)`.
- Workspace billing tokens (ADR-002) are **not** encrypted with this — they are
  bcrypt-**hashed** (`ws_token_hash`), since we only ever compare, never need
  the plaintext back.

API rules:

- `PUT /api/github/token` validates the PAT against `GET
  https://api.github.com/user`, then stores the ciphertext + resolved username.
- The token is **never** returned by any endpoint. `GET /api/github` returns
  only `{connected, username, connectedAt}`.
- On container start, if a PAT exists it is decrypted server-side and injected
  as a git credential helper (`~/.git-credentials` +
  `git config credential.helper store`) and `GH_TOKEN` for `gh` — written into
  the container, never sent to the browser.

## Consequences

- Losing `SECRETS_KEY` makes stored PATs unrecoverable (users re-enter — that's
  fine).
- Key rotation requires re-encrypting rows (out of scope; documented as a
  manual op).
