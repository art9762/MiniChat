# Per-user workspace image (ADR-001).
#
# node:22-bookworm + git, gh, ripgrep, build-essential and the Claude Code CLI
# installed globally. The container runs as the non-root `node` user with
# /workspace (a persistent named volume) as the working dir. It is kept alive
# with `sleep infinity` so the server can drive it via `docker exec`.
FROM node:22-bookworm

# Base tooling. The GitHub CLI (gh) ships from its own apt repository.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git \
      ripgrep \
      build-essential \
      ca-certificates \
      curl \
      gnupg \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# Claude Code CLI, installed globally so the agent runner can invoke `claude`.
RUN npm install -g @anthropic-ai/claude-code

# The `node` user already exists in the base image; ensure /workspace is owned
# by it so the agent can write to the mounted volume.
RUN mkdir -p /workspace && chown -R node:node /workspace

WORKDIR /workspace
USER node

# Stay up for `docker exec`; the server manages the real lifecycle.
CMD ["sleep", "infinity"]
