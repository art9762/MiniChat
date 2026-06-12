/**
 * RAG: chunking, indexing, retrieval, context formatting.
 */

import { db } from "./db.js";
import { nanoid } from "nanoid";
import {
  embedTexts,
  cosine,
  float32ToBuffer,
  bufferToFloat32,
  embeddingMode,
} from "./embeddings.js";

const CHARS_PER_TOKEN = 4; // rough heuristic: 1 token ≈ 4 chars

/** Split text into overlapping chunks of ~maxTokens each. */
export function chunkText(
  text: string,
  maxTokens = 500,
  overlap = 50
): string[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlap * CHARS_PER_TOKEN;

  // Split on paragraph boundaries first, then sentences
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const sentences = para.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      if (current.length + sentence.length + 1 > maxChars && current.length > 0) {
        chunks.push(current.trim());
        // overlap: keep last overlapChars of current
        current = current.slice(Math.max(0, current.length - overlapChars)) + " " + sentence;
      } else {
        current = current ? current + " " + sentence : sentence;
      }
    }
    // paragraph boundary: add a newline hint
    current += "\n\n";
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  // Final pass: split any over-limit chunks by brute-force
  const result: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxChars) {
      result.push(chunk);
    } else {
      for (let i = 0; i < chunk.length; i += maxChars - overlapChars) {
        result.push(chunk.slice(i, i + maxChars));
      }
    }
  }

  return result.filter((c) => c.trim().length > 0);
}

/** Chunk, embed, and store a file's text content into file_chunks. */
export async function indexFile(
  fileId: string,
  projectId: string,
  text: string
): Promise<void> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return;

  let embeddings: Float32Array[];
  try {
    embeddings = await embedTexts(chunks);
  } catch (err: any) {
    if (err?.isEmbeddingError) {
      // Trinity has no /v1/embeddings or returned an error.
      // Store chunks with zero-length embedding as placeholder for keyword fallback.
      console.error(`[rag] Embedding failed; storing chunks without embeddings for keyword fallback.`);
      embeddings = chunks.map(() => new Float32Array(0));
    } else {
      throw err;
    }
  }

  const insert = db.prepare(
    `INSERT OR REPLACE INTO file_chunks (id, file_id, project_id, chunk_index, content, embedding, token_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    // Clear old chunks for this file (re-index case)
    db.prepare(`DELETE FROM file_chunks WHERE file_id = ?`).run(fileId);

    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i];
      const embedding = embeddings[i];
      const tokenCount = Math.ceil(content.length / CHARS_PER_TOKEN);
      const embBuf = embedding.length > 0
        ? float32ToBuffer(embedding)
        : Buffer.alloc(0);
      insert.run(nanoid(), fileId, projectId, i, content, embBuf, tokenCount);
    }
  });

  tx();
  console.log(`[rag] Indexed file ${fileId}: ${chunks.length} chunks (mode=${embeddingMode})`);
}

export interface RetrievedChunk {
  content: string;
  fileId: string;
  fileName?: string;
  score: number;
}

const SCORE_THRESHOLD = 0.3;

/** Retrieve top-K relevant chunks for a query using cosine similarity. */
export async function retrieve(
  projectId: string,
  query: string,
  topK = 5
): Promise<RetrievedChunk[]> {
  type ChunkRow = {
    id: string;
    file_id: string;
    content: string;
    embedding: Buffer;
    name?: string;
  };

  const rows = db
    .prepare(
      `SELECT fc.id, fc.file_id, fc.content, fc.embedding, pf.name
       FROM file_chunks fc
       LEFT JOIN project_files pf ON pf.id = fc.file_id
       WHERE fc.project_id = ?`
    )
    .all(projectId) as ChunkRow[];

  if (rows.length === 0) return [];

  // Detect mode: if any row has an embedding, try vector retrieval
  const hasEmbeddings = rows.some((r) => r.embedding && r.embedding.length > 0);

  if (!hasEmbeddings) {
    // Keyword fallback (BM25-style simple term matching)
    console.log(`[rag] RAG_FALLBACK=keyword for project ${projectId}`);
    return keywordRetrieve(rows, query, topK);
  }

  let queryEmbedding: Float32Array;
  try {
    [queryEmbedding] = await embedTexts([query]);
  } catch (err: any) {
    console.error(`[rag] Query embedding failed, falling back to keyword: ${err?.message}`);
    return keywordRetrieve(rows, query, topK);
  }

  const scored = rows
    .map((row) => {
      const emb = bufferToFloat32(row.embedding);
      const score = cosine(queryEmbedding, emb);
      return { content: row.content, fileId: row.file_id, fileName: row.name, score };
    })
    .filter((r) => r.score >= SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

function keywordRetrieve(
  rows: { file_id: string; content: string; name?: string }[],
  query: string,
  topK: number
): RetrievedChunk[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (terms.length === 0) return [];

  const scored = rows.map((row) => {
    const text = row.content.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (text.includes(term)) score++;
    }
    return { content: row.content, fileId: row.file_id, fileName: row.name, score };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Format retrieved chunks as a context block for injection. */
export function buildContextBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  return chunks
    .map((c) => {
      const label = c.fileName ? `[from ${c.fileName}]` : `[from file ${c.fileId}]`;
      return `${label}\n${c.content}`;
    })
    .join("\n\n");
}
