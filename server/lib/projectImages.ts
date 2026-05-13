/**
 * Helpers for project image tools (search / view).
 */
import fs from "fs";
import { db } from "./db.js";
import { variantPath, type ImageResolution } from "./images.js";

export interface ProjectImageRow {
  id: string;
  project_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  has_variants: number;
  uploaded_at: number;
  storage_path: string;
}

export interface ImageSearchFilters {
  query?: string;
  mimeType?: string;
  minSize?: number;
  maxSize?: number;
  uploadedAfter?: number;
  uploadedBefore?: number;
  limit?: number;
}

/**
 * Fuzzy-ish search for images in a project.
 * - query: matched against name (case-insensitive LIKE %q% on each whitespace-separated token; AND across tokens)
 * - all other filters are exact ranges
 */
export function searchProjectImages(projectId: string, filters: ImageSearchFilters): ProjectImageRow[] {
  const wheres: string[] = [
    `project_id = ?`,
    `has_variants = 1`, // only indexed images
  ];
  const params: any[] = [projectId];

  if (filters.query && filters.query.trim()) {
    const tokens = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
    for (const tok of tokens) {
      wheres.push(`LOWER(name) LIKE ?`);
      params.push(`%${tok}%`);
    }
  }
  if (filters.mimeType) {
    wheres.push(`mime_type = ?`);
    params.push(filters.mimeType);
  }
  if (typeof filters.minSize === "number") {
    wheres.push(`size_bytes >= ?`);
    params.push(filters.minSize);
  }
  if (typeof filters.maxSize === "number") {
    wheres.push(`size_bytes <= ?`);
    params.push(filters.maxSize);
  }
  if (typeof filters.uploadedAfter === "number") {
    wheres.push(`uploaded_at >= ?`);
    params.push(filters.uploadedAfter);
  }
  if (typeof filters.uploadedBefore === "number") {
    wheres.push(`uploaded_at <= ?`);
    params.push(filters.uploadedBefore);
  }

  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);
  const sql = `SELECT id, project_id, name, mime_type, size_bytes, width, height, has_variants, uploaded_at, storage_path
               FROM project_files
               WHERE ${wheres.join(" AND ")}
               ORDER BY uploaded_at DESC
               LIMIT ${limit}`;
  return db.prepare(sql).all(...params) as ProjectImageRow[];
}

/**
 * Load one image variant as a base64 string for vision injection.
 * Returns null if file is missing on disk or row doesn't exist / wrong project.
 * Resolution is always low/medium/high (WebP), never original.
 */
export function loadProjectImageVariant(
  projectId: string,
  fileId: string,
  resolution: ImageResolution
): { b64: string; mimeType: string; name: string; width: number | null; height: number | null } | null {
  const row = db
    .prepare(`SELECT name, mime_type, storage_path, has_variants, width, height FROM project_files WHERE id = ? AND project_id = ?`)
    .get(fileId, projectId) as { name: string; mime_type: string; storage_path: string; has_variants: number; width: number | null; height: number | null } | undefined;
  if (!row || !row.has_variants) return null;
  const p = variantPath(row.storage_path, resolution);
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  return {
    b64: buf.toString("base64"),
    mimeType: "image/webp",
    name: row.name,
    width: row.width,
    height: row.height,
  };
}
