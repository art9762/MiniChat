/**
 * Embeddings via Trinity OpenAI-compatible endpoint.
 *
 * Env vars used:
 *   TRINITY_OPENAI_URL  — base URL (e.g. http://host:9999)
 *   TRINITY_OPENAI_KEY  — bearer token
 *
 * Falls back to keyword/BM25-style retrieval if the endpoint is unavailable.
 * Set RAG_FALLBACK=keyword in logs when fallback is active.
 */

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 32;

export let embeddingMode: "vector" | "keyword" = "vector";

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const url = `${process.env.TRINITY_OPENAI_URL}/v1/embeddings`;
  const key = process.env.TRINITY_OPENAI_KEY || "";

  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
      });
    } catch (err: any) {
      console.error(`[embeddings] Network error calling ${url}: ${err?.message}`);
      console.error(`[embeddings] RAG_FALLBACK=keyword activated`);
      embeddingMode = "keyword";
      throw Object.assign(new Error("Embeddings endpoint unavailable: " + err?.message), { isEmbeddingError: true });
    }

    if (!response.ok) {
      const text = await response.text();
      console.error(`[embeddings] HTTP ${response.status} from ${url}: ${text}`);
      console.error(`[embeddings] RAG_FALLBACK=keyword activated`);
      embeddingMode = "keyword";
      throw Object.assign(
        new Error(`Embeddings endpoint returned ${response.status}: ${text}`),
        { isEmbeddingError: true }
      );
    }

    let json: any;
    try {
      json = await response.json();
    } catch (err: any) {
      const errMsg = `Invalid JSON from embeddings endpoint: ${err?.message}`;
      console.error(`[embeddings] ${errMsg}`);
      embeddingMode = "keyword";
      throw Object.assign(new Error(errMsg), { isEmbeddingError: true });
    }

    if (!Array.isArray(json?.data)) {
      console.error(`[embeddings] Unexpected response shape:`, JSON.stringify(json).slice(0, 500));
      embeddingMode = "keyword";
      throw Object.assign(
        new Error("Embeddings endpoint returned unexpected shape — check logs"),
        { isEmbeddingError: true }
      );
    }

    for (const item of json.data) {
      if (!Array.isArray(item.embedding)) {
        console.error(`[embeddings] Missing embedding in item:`, JSON.stringify(item).slice(0, 200));
        throw new Error("Missing embedding array in response item");
      }
      results.push(new Float32Array(item.embedding));
    }
  }

  embeddingMode = "vector";
  return results;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Encode Float32Array as Buffer for DB storage */
export function float32ToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/** Decode Buffer from DB back to Float32Array */
export function bufferToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
