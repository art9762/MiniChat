# ADR-003: Disk quota (10 GB soft quota)

Status: Accepted · Date: 2026-06-12

## Context

Persistent per-user volumes can grow without bound. We need a fair-use limit
without the operational complexity of hard filesystem quotas in the default
deploy.

## Decision

**Soft quota**, default **10 GiB** per user (`workspaces.disk_quota_bytes`,
`DEFAULT_DISK_QUOTA_BYTES`). **Admins are unlimited** — their row is created
with `disk_quota_bytes = NULL`.

Enforcement points:

- `getDiskUsage(userId)` runs `du -sb /workspace` via `docker exec`, caches the
  result in `workspaces.disk_used_bytes`.
- **Before starting an agent run** and **before file upload**, if
  `disk_used_bytes >= disk_quota_bytes` (and quota is not NULL), the action is
  refused with a clear error, and the UI shows an over-quota banner.
- Usage is surfaced via `GET /api/files/usage` and `GET /api/workspace`.

Quota is editable by admins (`PATCH /api/admin/workspaces/:userId`, bytes or
GB; NULL = unlimited).

## Alternatives / future

Hard quotas via XFS project quotas are possible on a properly-provisioned Linux
host but are **opt-in at deploy time** (documented in `docs/deployment.md`).
The soft quota is enough to stop accidental runaway growth for a friends-scope
deployment.

## Consequences

- `du` on a large tree has cost; we cache and only refresh on demand / before
  gated actions, not continuously.
- A determined agent could briefly exceed quota between checks (soft, by
  design).
