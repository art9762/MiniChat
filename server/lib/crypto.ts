// AES-256-GCM symmetric encryption for secrets at rest (GitHub PATs, etc.).
// See ADR-005. Key is SECRETS_KEY in server/.env — 32 bytes as 64 hex chars.
// Stored format: "iv:tag:ciphertext" (all hex).
import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // 96-bit nonce, recommended for GCM

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.SECRETS_KEY;
  if (!raw) {
    throw new Error("SECRETS_KEY is not set (need 64 hex chars / 32 bytes)");
  }
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) {
    throw new Error(`SECRETS_KEY must be 32 bytes (64 hex chars), got ${buf.length} bytes`);
  }
  cachedKey = buf;
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const [ivHex, tagHex, ctHex] = stored.split(":");
  if (!ivHex || !tagHex || !ctHex) throw new Error("malformed ciphertext");
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]);
  return pt.toString("utf8");
}

// Generate a fresh opaque workspace billing token (returned once, never stored raw).
export function generateWorkspaceToken(): string {
  return "wsk_" + crypto.randomBytes(32).toString("hex");
}
