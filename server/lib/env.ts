// Validate required env vars at boot — fail fast instead of weird runtime errors.
const REQUIRED = [
  "TRINITY_OPENAI_URL",
  "TRINITY_OPENAI_KEY",
  "TRINITY_ANTHROPIC_URL",
  "TRINITY_ANTHROPIC_KEY",
] as const;

export function assertEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[env] Missing required vars: ${missing.join(", ")}`);
    console.error(`[env] Copy server/.env.example -> server/.env and fill values.`);
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production") {
    if (!process.env.CLIENT_ORIGIN) {
      console.error(`[env] CLIENT_ORIGIN is required in production`);
      process.exit(1);
    }
    if (!process.env.SESSION_COOKIE_SECURE) {
      console.warn(`[env] SESSION_COOKIE_SECURE not set — defaulting to '1' in production`);
    }
  }
}

export const isProd = () => process.env.NODE_ENV === "production";
export const cookieSecure = () =>
  process.env.SESSION_COOKIE_SECURE
    ? process.env.SESSION_COOKIE_SECURE === "1"
    : isProd();

// ── Claude Code Web workspace config ─────────────────────────────────────────

// Image used for per-user workspace containers (see deploy/workspace-image).
export const workspaceImage = () =>
  process.env.WORKSPACE_IMAGE || "minichat-workspace:latest";

// Idle minutes before the idle-reaper stops a running container.
export const workspaceIdleMinutes = () =>
  Number(process.env.WORKSPACE_IDLE_MINUTES || 15);

// Default per-user disk quota in bytes (10 GiB). Admins get NULL (unlimited).
export const DEFAULT_DISK_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

// Host:port the agent proxy is reachable at from inside a workspace container.
// Containers reach the host via host.docker.internal (mapped through
// extra_hosts: host-gateway). Override on Linux deploys if needed.
export const agentProxyBaseUrl = () =>
  process.env.AGENT_PROXY_BASE_URL ||
  `http://host.docker.internal:${process.env.PORT || 3001}/api/agent-proxy`;

// True once SECRETS_KEY is configured (GitHub/PAT features require it).
export const hasSecretsKey = () => {
  const k = process.env.SECRETS_KEY;
  return !!k && Buffer.from(k, "hex").length === 32;
};
