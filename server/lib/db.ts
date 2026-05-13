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
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
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
  cost INTEGER NOT NULL DEFAULT 0,
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
`);

// ── Projects schema ───────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS chats (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'New Chat',
  model      TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  master_prompt TEXT,
  memory        TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS project_invites (
  token       TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  max_uses    INTEGER NOT NULL DEFAULT 1,
  used_count  INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_files (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  text_content TEXT,
  uploaded_by  TEXT NOT NULL REFERENCES users(id),
  uploaded_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS file_chunks (
  id          TEXT PRIMARY KEY,
  file_id     TEXT NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content     TEXT NOT NULL,
  embedding   BLOB NOT NULL,
  token_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_chunks_project ON file_chunks(project_id);

`);

// Migration: chat_attachments table
{
  const caTableInfo = db.prepare(`PRAGMA table_info(chat_attachments)`).all() as { name: string }[];
  const hasChatId = caTableInfo.some((col) => col.name === "chat_id");
  if (caTableInfo.length === 0) {
    db.exec(`
      CREATE TABLE chat_attachments (
        id           TEXT PRIMARY KEY,
        chat_id      TEXT NOT NULL,
        message_id   TEXT REFERENCES messages(id) ON DELETE SET NULL,
        uploaded_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        mime_type    TEXT NOT NULL,
        size_bytes   INTEGER NOT NULL,
        storage_path TEXT NOT NULL,
        text_content TEXT,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_attachments_chat ON chat_attachments(chat_id);
      CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON chat_attachments(message_id);
    `);
  } else if (!hasChatId) {
    db.exec(`
      CREATE TABLE chat_attachments_new (
        id           TEXT PRIMARY KEY,
        chat_id      TEXT NOT NULL DEFAULT '',
        message_id   TEXT REFERENCES messages(id) ON DELETE SET NULL,
        uploaded_by  TEXT NOT NULL DEFAULT '',
        name         TEXT NOT NULL,
        mime_type    TEXT NOT NULL,
        size_bytes   INTEGER NOT NULL,
        storage_path TEXT NOT NULL,
        text_content TEXT,
        created_at   INTEGER NOT NULL
      );
      INSERT INTO chat_attachments_new (id, message_id, name, mime_type, size_bytes, storage_path, text_content, created_at)
        SELECT id, message_id, name, mime_type, size_bytes, storage_path, text_content, created_at
        FROM chat_attachments;
      DROP TABLE chat_attachments;
      ALTER TABLE chat_attachments_new RENAME TO chat_attachments;
      CREATE INDEX IF NOT EXISTS idx_chat_attachments_chat ON chat_attachments(chat_id);
      CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON chat_attachments(message_id);
    `);
  }

  // Migration: sources column on messages
  try { db.exec(`ALTER TABLE messages ADD COLUMN sources TEXT`); } catch {}

  // Migration: image metadata on chat_attachments
  for (const col of [
    `ALTER TABLE chat_attachments ADD COLUMN width INTEGER`,
    `ALTER TABLE chat_attachments ADD COLUMN height INTEGER`,
    `ALTER TABLE chat_attachments ADD COLUMN has_variants INTEGER NOT NULL DEFAULT 0`,
  ]) {
    try { db.exec(col); } catch {}
  }

  // Migration: image metadata on project_files
  for (const col of [
    `ALTER TABLE project_files ADD COLUMN width INTEGER`,
    `ALTER TABLE project_files ADD COLUMN height INTEGER`,
    `ALTER TABLE project_files ADD COLUMN has_variants INTEGER NOT NULL DEFAULT 0`,
  ]) {
    try { db.exec(col); } catch {}
  }
}

export type User = {
  id: string;
  username: string;
  password_hash: string;
  role: "user" | "admin";
  status: "active" | "suspended" | "banned";
  token_balance: number;
  created_at: number;
};
