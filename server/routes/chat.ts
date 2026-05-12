import { Router } from "express";
import {
  ChatRequest,
  isAnthropicModel,
  streamOpenAI,
  streamAnthropic,
} from "../lib/providers.js";
import { requireAuth } from "../lib/auth.js";
import { db } from "../lib/db.js";
import { calcCost, estimateInputTokens } from "../lib/pricing.js";

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

chatRouter.get("/models", requireAuth, (_req, res) => {
  res.json(MODELS);
});

chatRouter.post("/chat", requireAuth, async (req, res) => {
  const body: ChatRequest = req.body;
  if (!body.messages || !body.model) {
    return res.status(400).json({ error: "messages and model are required" });
  }
  const user = req.user!;
  if (user.token_balance <= 0) {
    return res.status(402).json({ error: "insufficient balance" });
  }
  // Pre-flight: rough estimate, reject if obviously broke
  const approxInput = body.messages.reduce((s, m) => s + estimateInputTokens(m.content), 0);
  const minCost = calcCost(body.model, approxInput, 100);
  if (user.token_balance < Math.ceil(minCost / 4)) {
    return res.status(402).json({ error: "insufficient balance" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let finalized = false;
  const finalize = (usage: { inputTokens: number; outputTokens: number }) => {
    if (finalized) return;
    finalized = true;
    const cost = calcCost(body.model, usage.inputTokens, usage.outputTokens);
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE users SET token_balance = MAX(0, token_balance - ?) WHERE id = ?`
      ).run(cost, user.id);
      db.prepare(
        `INSERT INTO usage_log (user_id, model, input_tokens, output_tokens, cost, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(user.id, body.model, usage.inputTokens, usage.outputTokens, cost, Date.now());
    });
    tx();
    const balance = (db.prepare(`SELECT token_balance FROM users WHERE id = ?`).get(user.id) as any)
      .token_balance as number;
    res.write(`data: ${JSON.stringify({ usage: { ...usage, cost, balance } })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  };

  const cb = {
    onContent: (chunk: string) => res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`),
    onDone: finalize,
    onError: (status: number, message: string) => {
      if (!finalized) {
        finalized = true;
        if (!res.headersSent) res.status(status).json({ error: message });
        else {
          res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
          res.end();
        }
      }
    },
  };

  try {
    if (isAnthropicModel(body.model)) {
      await streamAnthropic(body, cb);
    } else {
      await streamOpenAI(body, cb);
    }
  } catch (err: any) {
    cb.onError(500, err.message);
  }
});
