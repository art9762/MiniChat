/**
 * Image processing helpers (sharp).
 *
 * Strategy: for any uploaded image, generate three downscaled WebP variants:
 *   - low    : max 512px  (for cheap vision calls / thumbnails)
 *   - medium : max 1024px (default for LLM vision — good balance)
 *   - high   : max 1568px (Anthropic's recommended max — best detail, still safe)
 *
 * Original is also kept (for explicit download / future re-encode).
 * All variants are encoded as WebP quality=82 (much smaller than PNG/JPEG, vision-safe).
 *
 * Token math: Anthropic counts ~(w*h)/750 tokens per image.
 *   low    ~512x512  → ~350 tokens
 *   medium ~1024x1024 → ~1400 tokens
 *   high   ~1568x1568 → ~3275 tokens
 */

import sharp from "sharp";
import fs from "fs";
import path from "path";

export type ImageResolution = "low" | "medium" | "high";

export const RESOLUTION_MAX_DIM: Record<ImageResolution, number> = {
  low: 512,
  medium: 1024,
  high: 1568,
};

export const DEFAULT_RESOLUTION: ImageResolution = "medium";

export interface ImageMeta {
  width: number;
  height: number;
  format: string;
}

export interface ImageVariants {
  original: { path: string; width: number; height: number; mimeType: string; sizeBytes: number };
  low: { path: string; width: number; height: number; sizeBytes: number };
  medium: { path: string; width: number; height: number; sizeBytes: number };
  high: { path: string; width: number; height: number; sizeBytes: number };
}

/**
 * Detect if a MIME type / extension is a supported image format.
 */
export function isImageMime(mimeType: string, ext?: string): boolean {
  const e = (ext ?? "").toLowerCase();
  return (
    mimeType === "image/png" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/webp" ||
    mimeType === "image/gif" ||
    e === ".png" ||
    e === ".jpg" ||
    e === ".jpeg" ||
    e === ".webp" ||
    e === ".gif"
  );
}

/**
 * Get image dimensions / format from a buffer.
 */
export async function probeImage(buffer: Buffer): Promise<ImageMeta> {
  const m = await sharp(buffer).metadata();
  return {
    width: m.width ?? 0,
    height: m.height ?? 0,
    format: m.format ?? "unknown",
  };
}

/**
 * Generate one resized WebP variant. Returns the encoded buffer + dimensions.
 * If the source is already smaller than the target, it's still re-encoded
 * (so all variants are consistently WebP quality=82).
 */
async function encodeVariant(
  buffer: Buffer,
  resolution: ImageResolution
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const maxDim = RESOLUTION_MAX_DIM[resolution];
  const out = await sharp(buffer, { failOn: "none" })
    .rotate() // honor EXIF orientation
    .resize({
      width: maxDim,
      height: maxDim,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: out.data, width: out.info.width, height: out.info.height };
}

/**
 * Save the original image + 3 downscaled WebP variants to disk.
 * `baseDir`/`baseName` controls the on-disk layout, e.g.
 *   baseDir=/app/data/files/<projectId>
 *   baseName=<fileId>
 * Produces files:
 *   <baseName>           (original buffer)
 *   <baseName>.low.webp
 *   <baseName>.medium.webp
 *   <baseName>.high.webp
 */
export async function saveImageWithVariants(
  buffer: Buffer,
  baseDir: string,
  baseName: string,
  originalMime: string
): Promise<ImageVariants> {
  fs.mkdirSync(baseDir, { recursive: true });

  const originalPath = path.join(baseDir, baseName);
  fs.writeFileSync(originalPath, buffer);

  const meta = await probeImage(buffer);

  const [low, medium, high] = await Promise.all([
    encodeVariant(buffer, "low"),
    encodeVariant(buffer, "medium"),
    encodeVariant(buffer, "high"),
  ]);

  const lowPath = path.join(baseDir, `${baseName}.low.webp`);
  const medPath = path.join(baseDir, `${baseName}.medium.webp`);
  const highPath = path.join(baseDir, `${baseName}.high.webp`);

  fs.writeFileSync(lowPath, low.buffer);
  fs.writeFileSync(medPath, medium.buffer);
  fs.writeFileSync(highPath, high.buffer);

  return {
    original: {
      path: originalPath,
      width: meta.width,
      height: meta.height,
      mimeType: originalMime,
      sizeBytes: buffer.length,
    },
    low: { path: lowPath, width: low.width, height: low.height, sizeBytes: low.buffer.length },
    medium: { path: medPath, width: medium.width, height: medium.height, sizeBytes: medium.buffer.length },
    high: { path: highPath, width: high.width, height: high.height, sizeBytes: high.buffer.length },
  };
}

/**
 * Delete the original + all variants. Best-effort.
 */
export function deleteImageVariants(originalPath: string): void {
  const suffixes = ["", ".low.webp", ".medium.webp", ".high.webp"];
  for (const sfx of suffixes) {
    try {
      fs.unlinkSync(originalPath + sfx);
    } catch (e: any) {
      if (e?.code !== "ENOENT") {
        // swallow other errors — caller deletes from DB anyway
      }
    }
  }
}

/**
 * Resolve the on-disk path for a given resolution (original | low | medium | high).
 * Falls back to original if the variant file is missing.
 */
export function variantPath(originalPath: string, resolution: ImageResolution | "original"): string {
  if (resolution === "original") return originalPath;
  const candidate = `${originalPath}.${resolution}.webp`;
  return fs.existsSync(candidate) ? candidate : originalPath;
}

/**
 * Mime type for a stored variant.
 */
export function variantMime(originalMime: string, resolution: ImageResolution | "original"): string {
  if (resolution === "original") return originalMime;
  return "image/webp";
}
