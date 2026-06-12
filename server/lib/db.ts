import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, "minichat.db");
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',          -- 'user' | 'admin'
  status TEXT NOT NULL DEFAULT 'active',      -- 'active' | 'suspended' | 'banned'
  token_balance INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_by TEXT,
  used_at INTEGER,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (used_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS token_codes (
  code TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_by TEXT,
  used_at INTEGER,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (used_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,            -- spent from balance
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_log(user_id);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  payload TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at);

-- ── Claude Code Web: workspaces, github, agent sessions ──────────────────────

-- One persistent workspace per user (named docker volume + on-demand container).
CREATE TABLE IF NOT EXISTS workspaces (
  user_id          TEXT PRIMARY KEY,
  volume_name      TEXT NOT NULL,
  container_id     TEXT,
  status           TEXT NOT NULL DEFAULT 'none',   -- none|starting|running|stopped|error
  last_activity_at INTEGER,
  disk_used_bytes  INTEGER NOT NULL DEFAULT 0,
  disk_quota_bytes INTEGER DEFAULT 10737418240,    -- 10 GiB; NULL = unlimited (admins)
  ws_token_hash    TEXT,                           -- bcrypt hash of the workspace billing token
  created_at       INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Encrypted GitHub PAT per user (AES-256-GCM, see lib/crypto.ts / ADR-005).
CREATE TABLE IF NOT EXISTS github_tokens (
  user_id         TEXT PRIMARY KEY,
  token_encrypted TEXT NOT NULL,                   -- iv:tag:ciphertext (hex)
  github_username TEXT,
  connected_at    INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Agent (Claude Code CLI) conversation sessions; cli_session_id enables --resume.
CREATE TABLE IF NOT EXISTS agent_sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT 'New session',
  cli_session_id TEXT,                             -- Claude Code CLI session id for --resume
  status         TEXT NOT NULL DEFAULT 'idle',     -- idle|running|error
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user ON agent_sessions(user_id);

-- Persisted stream of agent run events (assistant text, tool_use, tool_result, result…).
CREATE TABLE IF NOT EXISTS agent_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  type         TEXT NOT NULL,
  payload_json TEXT,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events(session_id);
`);

// ── Lightweight forward-migrations for existing DBs (add columns if missing) ──
function hasColumn(table: string, col: string): boolean {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return cols.some((c) => c.name === col);
  } catch {
    return false;
  }
}
// (reserved for future additive migrations; tables above are created idempotently)
void hasColumn;

export type User = {
  id: string;
  username: string;
  password_hash: string;
  role: "user" | "admin";
  status: "active" | "suspended" | "banned";
  token_balance: number;
  created_at: number;
};

export type WorkspaceStatus = "none" | "starting" | "running" | "stopped" | "error";

export type Workspace = {
  user_id: string;
  volume_name: string;
  container_id: string | null;
  status: WorkspaceStatus;
  last_activity_at: number | null;
  disk_used_bytes: number;
  disk_quota_bytes: number | null; // null = unlimited
  ws_token_hash: string | null;
  created_at: number;
};

export type GithubToken = {
  user_id: string;
  token_encrypted: string;
  github_username: string | null;
  connected_at: number;
};

export type AgentSessionStatus = "idle" | "running" | "error";

export type AgentSession = {
  id: string;
  user_id: string;
  title: string;
  cli_session_id: string | null;
  status: AgentSessionStatus;
  created_at: number;
  updated_at: number;
};

export type AgentEventRow = {
  id: number;
  session_id: string;
  type: string;
  payload_json: string | null;
  created_at: number;
};
