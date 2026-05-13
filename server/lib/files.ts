import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { isImageMime } from "./images.js";

const require = createRequire(import.meta.url);

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_PROJECT_SIZE = 150 * 1024 * 1024; // 150 MB

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedFile {
  textContent: string | null;
  mimeType: string;
  normalizedName: string;
  isImage: boolean;
}

// ── Parse ─────────────────────────────────────────────────────────────────────

export async function parseFile(
  buffer: Buffer,
  mimeType: string,
  originalName: string
): Promise<ParsedFile> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw Object.assign(new Error("file exceeds 10 MB limit"), { status: 400 });
  }

  const normalizedName = path.basename(originalName).replace(/[^a-zA-Z0-9._\-]/g, "_");
  const ext = path.extname(originalName).toLowerCase();

  // Images — caller handles resizing/variants via lib/images.ts.
  // parseFile only flags this case so the route can take the image branch.
  if (isImageMime(mimeType, ext)) {
    // Normalize mime if missing
    const mt =
      mimeType ||
      (ext === ".png"
        ? "image/png"
        : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
        ? "image/gif"
        : "image/jpeg");
    return { textContent: null, mimeType: mt, normalizedName, isImage: true };
  }

  // Text files (text/*, .md, .txt, code files)
  if (mimeType.startsWith("text/") || isTextExtension(ext)) {
    const textContent = buffer.toString("utf-8");
    return { textContent, mimeType: mimeType || "text/plain", normalizedName, isImage: false };
  }

  // PDF
  if (mimeType === "application/pdf" || ext === ".pdf") {
    const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require("pdf-parse");
    const data = await pdfParse(buffer);
    return { textContent: data.text || null, mimeType: "application/pdf", normalizedName, isImage: false };
  }

  // DOCX
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === ".docx"
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return {
      textContent: result.value || null,
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      normalizedName,
      isImage: false,
    };
  }

  throw Object.assign(
    new Error(`unsupported file type: ${mimeType || ext || "unknown"}`),
    { status: 415 }
  );
}

function isTextExtension(ext: string): boolean {
  const TEXT_EXTS = new Set([
    ".txt", ".md", ".markdown", ".csv", ".json", ".xml", ".yaml", ".yml",
    ".html", ".htm", ".css", ".js", ".ts", ".jsx", ".tsx", ".py", ".rb",
    ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".sh", ".bash",
    ".env", ".toml", ".ini", ".conf", ".log", ".sql",
  ]);
  return TEXT_EXTS.has(ext);
}

// ── Storage ───────────────────────────────────────────────────────────────────

export function saveFile(projectId: string, fileId: string, buffer: Buffer): string {
  const dir = path.join(DATA_DIR, "files", projectId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileId);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

export function readFile(storagePath: string): Buffer {
  return fs.readFileSync(storagePath);
}

export function deleteFile(storagePath: string): void {
  try {
    fs.unlinkSync(storagePath);
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
}

export function projectFileDir(projectId: string): string {
  return path.join(DATA_DIR, "files", projectId);
}

export function chatAttachmentDir(chatId: string): string {
  return path.join(DATA_DIR, "files", "chat-attachments", chatId);
}
