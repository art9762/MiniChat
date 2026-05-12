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
  if (!process.env.TAVILY_API_KEY) console.warn("[env] TAVILY_API_KEY not set — web search disabled");
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
