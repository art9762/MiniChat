# ADR-001: Per-user workspace runtime

Status: Accepted · Date: 2026-06-12

## Context

MiniChat is becoming a Claude Code Web clone: each user gets a personal "VM"
where an agent (the Claude Code CLI) operates on a real filesystem with full
shell, git, and network access. We need an isolation boundary that is safe to
expose to an autonomous agent running with `--dangerously-skip-permissions`.

## Decision

Each user gets a dedicated **Docker container** plus a **persistent named volume**.

- **Image** (`deploy/workspace-image/Dockerfile`): `node:22-bookworm` +
  `git`, `gh`, `ripgrep`, `build-essential`, and `@anthropic-ai/claude-code`
  installed globally.
- **Volume** `mc-ws-<userId>` mounted at `/workspace`. The volume is permanent
  (survives container stop/remove); the container is disposable and
  on-demand.
- **Container** name `mc-ws-<userId>`, labelled `minichat.user=<userId>` so the
  server can enumerate only its own containers.
- **Limits**: `--memory 2g --cpus 2 --pids-limit 512`.
- **Hardening**: `--security-opt no-new-privileges`, non-root user (`node`),
  **no docker socket** inside the container, read-only nowhere that breaks npm
  but no host bind-mounts beyond the named volume.
- **Networking**: standard bridge (agent needs the internet for npm/git). The
  server's own API is **not** reachable from the container except the agent
  billing proxy, exposed via `host.docker.internal` (`extra_hosts:
  host-gateway`). The container never receives Trinity keys.

## Lifecycle

On-demand start: the container is created/started when the user opens the
workspace or launches the agent. An **idle-reaper** (60s interval) stops
containers whose `last_activity_at` is older than `WORKSPACE_IDLE_MINUTES`
(default 15). The volume is untouched, so files persist across restarts.

The server manages containers via **dockerode** over the host docker socket.
Dev is macOS Docker Desktop; prod is a Linux host. (At authoring time the local
docker daemon is down — E2E tests require Docker Desktop running.)

## Consequences

- Strong isolation per user; blast radius is one container + one volume.
- Requires the server to have docker socket access (a privileged dependency,
  documented in `docs/deployment.md`).
- Cold-start latency on first agent run (container create+start).
