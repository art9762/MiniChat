/**
 * Chat Attachments
 * POST   /api/chats/:chatId/attachments               — upload file (images get 3 webp variants)
 * GET    /api/chats/:chatId/attachments/:id           — metadata
 * GET    /api/chats/:chatId/attachments/:id/download  — stream original
 * GET    /api/chats/:chatId/attachments/:id/variant/:res  — stream resized variant (low|medium|high)
 * DELETE /api/chats/:chatId/attachments/:id           — remove (pending only)
 */

import { Router } from "express";
import { nanoid } from "nanoid";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { parseFile, MAX_FILE_SIZE, chatAttachmentDir } from "../lib/files.js";
import {
  saveImageWithVariants,
  deleteImageVariants,
  variantPath,
  variantMime,
  type ImageResolution,
} from "../lib/images.js";
import { getMember } from "./projects.js";

export const attachmentsRouter = Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

function canAccessChat(chatId: string, userId: string): boolean {
  const chat = db
    .prepare(`SELECT user_id, project_id FROM chats WHERE id = ?`)
    .get(chatId) as { user_id: string; project_id: string | null } | undefined;
  if (!chat) return true; // localStorage-only chat
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

// ── POST upload ─────────────────────────────────────────────────────────────
attachmentsRouter.post("/", requireAuth, upload.single("file"), async (req, res) => {
  const user = (req as any).user;
  const chatId = req.params.chatId as string;

  if (!req.file) return res.status(400).json({ error: "no file uploaded" });
  if (!canAccessChat(chatId, user.id)) return res.status(403).json({ error: "access denied" });

  try {
    const parsed = await parseFile(req.file.buffer, req.file.mimetype, req.file.originalname);

    const id = nanoid();
    const dir = chatAttachmentDir(chatId);
    fs.mkdirSync(dir, { recursive: true });
    const storagePath = path.join(dir, id);

    let width: number | null = null;
    let height: number | null = null;
    let hasVariants = 0;

    if (parsed.isImage) {
      const v = await saveImageWithVariants(req.file.buffer, dir, id, parsed.mimeType);
      width = v.original.width;
      height = v.original.height;
      hasVariants = 1;
    } else {
      fs.writeFileSync(storagePath, req.file.buffer);
    }

    const now = Date.now();
    db.prepare(
      `INSERT INTO chat_attachments (id, chat_id, message_id, uploaded_by, name, mime_type, size_bytes, storage_path, text_content, width, height, has_variants, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, chatId, user.id, parsed.normalizedName, parsed.mimeType, req.file.size, storagePath, parsed.textContent ?? null, width, height, hasVariants, now);

    res.status(201).json({
      id,
      name: parsed.normalizedName,
      mimeType: parsed.mimeType,
      size: req.file.size,
      chatId,
      width,
      height,
      hasVariants: !!hasVariants,
    });
  } catch (err: any) {
    sendErr(res, err);
  }
});

// ── GET metadata ─────────────────────────────────────────────────────────────
attachmentsRouter.get("/:id", requireAuth, (req, res) => {
  const user = (req as any).user;
  const chatId = req.params.chatId as string;
  const id = req.params.id as string;
  if (!canAccessChat(chatId, user.id)) return res.status(403).json({ error: "access denied" });

  const row = db
    .prepare(`SELECT id, chat_id, message_id, name, mime_type, size_bytes, width, height, has_variants, created_at FROM chat_attachments WHERE id = ? AND chat_id = ?`)
    .get(id, chatId);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(row);
});

// ── GET download (original) ───────────────────────────────────────────────────
attachmentsRouter.get("/:id/download", requireAuth, (req, res) => {
  const user = (req as any).user;
  const chatId = req.params.chatId as string;
  const id = req.params.id as string;
  if (!canAccessChat(chatId, user.id)) return res.status(403).json({ error: "access denied" });

  const row = db
    .prepare(`SELECT name, mime_type, storage_path FROM chat_attachments WHERE id = ? AND chat_id = ?`)
    .get(id, chatId) as { name: string; mime_type: string; storage_path: string } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  if (!fs.existsSync(row.storage_path)) return res.status(404).json({ error: "file missing" });

  res.setHeader("Content-Type", row.mime_type);
  res.setHeader("Content-Disposition", `inline; filename="${row.name}"`);
  fs.createReadStream(row.storage_path).pipe(res);
});

// ── GET resized variant ───────────────────────────────────────────────────────
attachmentsRouter.get("/:id/variant/:res", requireAuth, (req, res) => {
  const user = (req as any).user;
  const chatId = req.params.chatId as string;
  const id = req.params.id as string;
  const resolution = req.params.res as ImageResolution | "original";
  if (!["low", "medium", "high", "original"].includes(resolution)) {
    return res.status(400).json({ error: "invalid resolution" });
  }
  if (!canAccessChat(chatId, user.id)) return res.status(403).json({ error: "access denied" });

  const row = db
    .prepare(`SELECT name, mime_type, storage_path, has_variants FROM chat_attachments WHERE id = ? AND chat_id = ?`)
    .get(id, chatId) as { name: string; mime_type: string; storage_path: string; has_variants: number } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  if (!row.has_variants && resolution !== "original") return res.status(404).json({ error: "no variants" });

  const p = variantPath(row.storage_path, resolution);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "variant missing" });
  res.setHeader("Content-Type", variantMime(row.mime_type, resolution));
  res.setHeader("Cache-Control", "private, max-age=86400");
  fs.createReadStream(p).pipe(res);
});

// ── DELETE ───────────────────────────────────────────────────────────────────────
attachmentsRouter.delete("/:id", requireAuth, (req, res) => {
  const user = (req as any).user;
  const chatId = req.params.chatId as string;
  const id = req.params.id as string;

  const row = db
    .prepare(`SELECT message_id, storage_path, uploaded_by, has_variants FROM chat_attachments WHERE id = ? AND chat_id = ?`)
    .get(id, chatId) as { message_id: string | null; storage_path: string; uploaded_by: string; has_variants: number } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  if (row.uploaded_by !== user.id) return res.status(403).json({ error: "access denied" });
  if (row.message_id) return res.status(400).json({ error: "cannot delete attached attachment" });

  if (row.has_variants) {
    deleteImageVariants(row.storage_path);
  } else {
    try { fs.unlinkSync(row.storage_path); } catch {}
  }
  db.prepare(`DELETE FROM chat_attachments WHERE id = ?`).run(id);
  res.json({ ok: true });
});
