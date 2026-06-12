# MiniChat workspace image

The per-user "VM" image for Claude Code Web (see
[`docs/adr/ADR-001-workspace-runtime.md`](../../docs/adr/ADR-001-workspace-runtime.md)).

One container per user, named `mc-ws-<userId>`, runs this image with a
persistent named volume `mc-ws-<userId>` mounted at `/workspace`. The Claude
Code CLI inside the container talks to MiniChat's billing proxy
(`ANTHROPIC_BASE_URL`) with a scoped workspace token (`ANTHROPIC_API_KEY`) — the
real Trinity keys never enter the container.

## Contents

- `node:22-bookworm` base
- `git`, `gh` (GitHub CLI), `ripgrep`, `build-essential`
- `@anthropic-ai/claude-code` installed globally
- Runs as non-root `node`, `WORKDIR /workspace`, `CMD ["sleep","infinity"]`

## Build

```bash
# from repo root (uses WORKSPACE_IMAGE or the default tag)
npm run build:workspace-image -w server

# or directly
docker build -t minichat-workspace:latest deploy/workspace-image
```

Set `WORKSPACE_IMAGE` in `server/.env` if you tag it differently. The server
hardens each container at create time: `--memory 2g`, `--cpus 2`,
`--pids-limit 512`, `--security-opt no-new-privileges`, no docker socket, and
only the named volume mounted.
