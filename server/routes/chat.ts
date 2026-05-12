import { Router } from "express";
import {
  ChatRequest,
  isAnthropicModel,
  streamOpenAI,
  streamAnthropic,
} from "../lib/providers.js";
import { requireAuth } from "../lib/auth.js";
import { db } from "../lib/db.js";
import { calcCost, estimateInputTokens, priceOf } from "../lib/pricing.js";
import { chatLimiter } from "../lib/rateLimit.js";
import { retrieve, buildContextBlock } from "../lib/rag.js";
import { getMember } from "./projects.js";
import { updateProjectMemory } from "../lib/memory.js";

export const chatRouter = Router();

const MODELS = [
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", provider: "anthropic", tier: "premium" },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic", tier: "premium" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", tier: "standard" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic", tier: "fast" },
  { id: "claude-sonnet-4-6-1m", name: "Claude Sonnet 4.6 1M", provider: "anthropic", tier: "standard" },
  { id: "claude-opus-4-6-1m", name: "Claude Opus 4.6 1M", provider: "anthropic", tier: "premium" },
  { id: "claude-opus-4-7-1m", name: "Claude Opus 4.7 1M", provider: "anthropic", tier: "premium" },
  { id: "gpt-5.4", name: "GPT-5.4", provider: "openai", tier: "premium" },
  { id: "gpt-5.2", name: "GPT-5.2", provider: "openai", tier: "standard" },
  { id: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai", tier: "fast" },
];
const MODEL_IDS = new Set(MODELS.map((m) => m.id));

const MAX_MESSAGES = 100;
const MAX_TOTAL_CHARS = 200_000;
const MAX_OUTPUT_TOKENS = 4096; // matches providers.ts max_tokens

chatRouter.get("/models", requireAuth, (_req, res) => {
  res.json(MODELS);
});

chatRouter.post("/chat", chatLimiter, requireAuth, async (req, res) => {
  const body: ChatRequest & { projectId?: string } = req.body;

  // --- Validation ---------------------------------------------------------
  if (!body || !Array.isArray(body.messages) || !body.model) {
    return res.status(400).json({ error: "messages and model are required" });
  }
  if (!MODEL_IDS.has(body.model)) {
    return res.status(400).json({ error: "unknown model" });
  }
  if (body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: `messages must be 1..${MAX_MESSAGES}` });
  }
  let totalChars = 0;
  for (const m of body.messages) {
    if (!m || typeof m.content !== "string" || !["user", "assistant", "system"].includes(m.role)) {
      return res.status(400).json({ error: "invalid message shape" });
    }
    totalChars += m.content.length;
  }
  if (typeof body.systemPrompt === "string") totalChars += body.systemPrompt.length;

  // --- Project RAG context -----------------------------------------------
  let projectSystemPrompt: string | undefined;
  if (body.projectId) {
    const user = req.user!;
    // Verify membership
    const membership = getMember(body.projectId, user.id);
    if (!membership) {
      return res.status(403).json({ error: "not a member of this project" });
    }

    const project = db.prepare(`SELECT master_prompt, memory FROM projects WHERE id = ?`).get(body.projectId) as
      | { master_prompt: string | null; memory: string | null }
      | undefined;

    if (project) {
      // Get the last user message as query for retrieval
      const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user");
      const query = lastUserMsg?.content ?? "";

      let contextBlock = "";
      if (query) {
        try {
          const chunks = await retrieve(body.projectId, query, 5);
          contextBlock = buildContextBlock(chunks);
        } catch (err: any) {
          console.error("[chat] RAG retrieve error:", err?.message);
        }
      }

      const parts: string[] = [];
      if (project.master_prompt) parts.push(project.master_prompt);
      if (project.memory) parts.push(`[Project memory]\n${project.memory}`);
      if (contextBlock) parts.push(`[Retrieved context]\n${contextBlock}`);

      if (parts.length > 0) {
        projectSystemPrompt = parts.join("\n\n");
        totalChars += projectSystemPrompt.length;
      }
    }
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return res.status(413).json({ error: `payload too large (>${MAX_TOTAL_CHARS} chars)` });
  }

  const user = req.user!;
  if (user.token_balance <= 0) {
    return res.status(402).json({ error: "insufficient balance" });
  }

  // --- Balance hold (prevents free-Opus race) ------------------------------
  // Estimate maximum possible cost: actual input tokens + max_output_tokens at this model's price.
  // Atomically reserve from the balance; refund the difference after the stream.
  const approxInput = body.messages.reduce((s, m) => s + estimateInputTokens(m.content), 0)
    + (projectSystemPrompt ? estimateInputTokens(projectSystemPrompt) : 0)
    + (body.systemPrompt ? estimateInputTokens(body.systemPrompt) : 0);
  const hold = Math.max(1, calcCost(body.model, approxInput, MAX_OUTPUT_TOKENS));

  const holdRes = db
    .prepare(
      `UPDATE users SET token_balance = token_balance - ?
       WHERE id = ? AND token_balance >= ?`
    )
    .run(hold, user.id, hold);
  if (holdRes.changes === 0) {
    return res.status(402).json({ error: "insufficient balance for this request" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let finalized = false;
  let assistantBuffer = "";

  // Capture last user message for memory hook
  const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const settle = (usage: { inputTokens: number; outputTokens: number } | null) => {
    if (finalized) return;
    finalized = true;
    const actualUsage = usage ?? { inputTokens: 0, outputTokens: 0 };
    const actualCost = calcCost(body.model, actualUsage.inputTokens, actualUsage.outputTokens);
    const delta = hold - actualCost; // positive => refund, negative => additional charge

    const tx = db.transaction(() => {
      // Refund (or charge) the difference. A negative delta would charge more than was held.
      db.prepare(
        `UPDATE users SET token_balance = MAX(0, token_balance + ?) WHERE id = ?`
      ).run(delta, user.id);
      db.prepare(
        `INSERT INTO usage_log (user_id, model, input_tokens, output_tokens, cost, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(user.id, body.model, actualUsage.inputTokens, actualUsage.outputTokens, actualCost, Date.now());
    });
    tx();

    const balance = (db.prepare(`SELECT token_balance FROM users WHERE id = ?`).get(user.id) as any)
      .token_balance as number;

    if (!res.headersSent) {
      res.json({ usage: { ...actualUsage, cost: actualCost, balance } });
    } else {
      res.write(`data: ${JSON.stringify({ usage: { ...actualUsage, cost: actualCost, balance } })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
    }

    // Fire-and-forget memory update after stream completes
    if (usage && body.projectId && assistantBuffer) {
      updateProjectMemory(body.projectId, user.id, lastUserMsg, assistantBuffer)
        .catch((err) => console.error("[memory] hook error:", err));
    }
  };

  const cb = {
    onContent: (chunk: string) => {
      assistantBuffer += chunk;
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
    },
    onDone: settle,
    onError: (status: number, message: string) => {
      // Log full upstream error server-side, return generic to client.
      console.error(`[upstream ${status}]`, message);
      if (finalized) return;
      // Refund full hold on error.
      finalized = true;
      db.prepare(
        `UPDATE users SET token_balance = token_balance + ? WHERE id = ?`
      ).run(hold, user.id);
      const safeStatus = status >= 400 && status < 600 ? status : 502;
      const generic = { error: "upstream_error", status: safeStatus };
      if (!res.headersSent) {
        res.status(safeStatus).json(generic);
      } else {
        res.write(`data: ${JSON.stringify(generic)}\n\n`);
        res.end();
      }
    },
  };

  // If the client disconnects mid-stream, refund hold so user isn't charged for nothing.
  req.on("close", () => {
    if (finalized) return;
    finalized = true;
    db.prepare(
      `UPDATE users SET token_balance = token_balance + ? WHERE id = ?`
    ).run(hold, user.id);
  });

  try {
    const effectiveBody = projectSystemPrompt
      ? { ...body, systemPrompt: projectSystemPrompt }
      : body;
    if (isAnthropicModel(body.model)) {
      await streamAnthropic(effectiveBody, cb);
    } else {
      await streamOpenAI(effectiveBody, cb);
    }
  } catch (err: any) {
    cb.onError(500, err?.message || "internal error");
  }
});

// suppress unused import warnings in environments where priceOf isn't used directly here
void priceOf;
