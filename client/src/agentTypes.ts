// Mirror of server/lib/agentTypes.ts — kept in sync manually (no cross-workspace import).
// Shared contracts between the agent runner (server) and this UI.

// ── WebSocket protocol: /api/agent/ws?session=<id> ───────────────────────────

// Client → Server
export type AgentClientMessage =
  | { type: "prompt"; text: string; model?: string }
  | { type: "cancel" };

// Server → Client
export type AgentServerMessage =
  | { type: "status"; status: "starting" | "running" | "idle" | "error"; detail?: string }
  | { type: "assistant_text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; content: string; isError?: boolean }
  | {
      type: "result";
      subtype?: string;
      costUnits: number; // billed balance units for this run
      balance: number; // remaining user balance
      inputTokens: number;
      outputTokens: number;
      durationMs?: number;
    }
  | { type: "error"; message: string; code?: number };

// ── Agent CLI model whitelist (what the UI may request) ──────────────────────
export const AGENT_MODELS = [
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", tier: "standard" },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", tier: "premium" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", tier: "fast" },
] as const;

export type AgentModelId = (typeof AGENT_MODELS)[number]["id"];

// ── REST DTOs ────────────────────────────────────────────────────────────────

export interface WorkspaceDTO {
  status: "none" | "starting" | "running" | "stopped" | "error";
  diskUsedBytes: number;
  diskQuotaBytes: number | null; // null = unlimited
  lastActivityAt: number | null;
}

export interface AgentSessionDTO {
  id: string;
  title: string;
  status: "idle" | "running" | "error";
  createdAt: number;
  updatedAt: number;
}

export interface FileEntryDTO {
  name: string;
  type: "file" | "dir";
  size: number;
  mtime: number;
}

export interface GithubStatusDTO {
  connected: boolean;
  username: string | null;
  connectedAt: number | null;
}
