/**
 * Chat Attachments (P6)
 * POST   /api/chats/:chatId/attachments       — upload a file, returns attachment metadata
 * GET    /api/chats/:chatId/attachments/:id   — get metadata
 * GET    /api/chats/:chatId/attachments/:id/download — stream file
 * DELETE /api/chats/:chatId/attachments/:id   — remove (pending only)
 *
 * TODO: cleanup job for unlinked attachments older than 24h
 */

import { Router } from "express";
import { nanoid } from "nanoid";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { parseFile, MAX_FILE_SIZE } from "../lib/files.js";
import { getMember } from "./projects.js";

export const attachmentsRouter = Router({ mergeParams: true });

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "data");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

// ── Auth helper: user owns chat OR is member of chat's project, OR the chat exists in DB
// Note: conversations may be localStorage-only (no DB row) — in that case, any authed user
// can upload to any chatId they know (security through obscurity of nanoid). We require auth always.
function canAccessChat(chatId: string, userId: string): boolean {
  // If a DB chat row exists, check ownership
  const chat = db
    .prepare(`SELECT user_id, project_id FROM chats WHERE id = ?`)
    .get(chatId) as { user_id: string; project_id: string | null } | undefined;
  if (!chat) {
    // No DB row — allow any authenticated user (chat is client-side only)
    return true;
  }
  if (chat.user_id === userId) return true;
  if (chat.project_id) {
    const m = getMember(chat.project_id, userId);
    if (m) return true;
  }
  return false;
}

function sendErr(res: any, err: any) {
  const status = err?.status ?? 500;
  res.status(status).json({ error: err?.message ?? "internal error" });
}

// ── POST /api/chats/:chatId/attachments ───────────────────────────────────────
attachmentsRouter.post("/", requireAuth, upload.single("file"), async (req, res) => {
  const user = (req as any).user;
  const chatId = req.params.chatId as string;

  if (!req.file) return res.status(400).json({ error: "no file uploaded" });

  if (!canAccessChat(chatId, user.id)) {
    return res.status(403).json({ error: "access denied" });
  }

  try {
    const parsed = await parseFile(req.file.buffer, req.file.mimetype, req.file.originalname);

    const id = nanoid();
    const dir = path.join(DATA_DIR, "files", "chat-attachments", chatId);
    fs.mkdirSync(dir, { recursive: true });
    const storagePath = path.join(dir, id);
    fs.writeFileSync(storagePath, req.file.buffer);

    const now = Date.now();
    db.prepare(
      `INSERT INTO chat_attachments (id, chat_id, message_id, uploaded_by, name, mime_type, size_bytes, storage_path, text_content, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, chatId, user.id, parsed.normalizedName, parsed.mimeType, req.file.size, storagePath, parsed.textContent ?? null, now);

    res.status(201).json({
      id,
      name: parsed.normalizedName,
      mimeType: parsed.mimeType,
      size: req.file.size,
      chatId,
    });
  } catch (err: any) {
    sendErr(res, err);
  }
});

// ── GET /api/chats/:chatId/attachments/:id ────────────────────────────────────
attachmentsRouter.get("/:id", requireAuth, (req, res) => {
  const user = (req as any).user;
  const chatId = req.params.chatId as string; const id = req.params.id as string;

  if (!canAccessChat(chatId, user.id)) {
    return res.status(403).json({ error: "access denied" });
  }

  const row = db
    .prepare(`SELECT id, chat_id, message_id, name, mime_type, size_bytes, created_at FROM chat_attachments WHERE id = ? AND chat_id = ?`)
    .get(id, chatId);

  if (!row) return res.status(404).json({ error: "not found" });
  res.json(row);
});

// ── GET /api/chats/:chatId/attachments/:id/download ───────────────────────────
attachmentsRouter.get("/:id/download", requireAuth, (req, res) => {
  const user = (req as any).user;
  const chatId = req.params.chatId as string; const id = req.params.id as string;

  if (!canAccessChat(chatId, user.id)) {
    return res.status(403).json({ error: "access denied" });
  }

  const row = db
    .prepare(`SELECT name, mime_type, storage_path FROM chat_attachments WHERE id = ? AND chat_id = ?`)
    .get(id, chatId) as { name: string; mime_type: string; storage_path: string } | undefined;

  if (!row) return res.status(404).json({ error: "not found" });
  if (!fs.existsSync(row.storage_path)) return res.status(404).json({ error: "file missing" });

  res.setHeader("Content-Type", row.mime_type);
  res.setHeader("Content-Disposition", `inline; filename="${row.name}"`);
  fs.createReadStream(row.storage_path).pipe(res);
});

// ── DELETE /api/chats/:chatId/attachments/:id ─────────────────────────────────
attachmentsRouter.delete("/:id", requireAuth, (req, res) => {
  const user = (req as any).user;
  const chatId = req.params.chatId as string; const id = req.params.id as string;

  const row = db
    .prepare(`SELECT message_id, storage_path, uploaded_by FROM chat_attachments WHERE id = ? AND chat_id = ?`)
    .get(id, chatId) as { message_id: string | null; storage_path: string; uploaded_by: string } | undefined;

  if (!row) return res.status(404).json({ error: "not found" });
  if (row.uploaded_by !== user.id) return res.status(403).json({ error: "access denied" });
  if (row.message_id) return res.status(400).json({ error: "cannot delete attached attachment" });

  try {
    fs.unlinkSync(row.storage_path);
  } catch {}

  db.prepare(`DELETE FROM chat_attachments WHERE id = ?`).run(id);
  res.json({ ok: true });
});
