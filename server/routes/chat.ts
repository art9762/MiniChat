import { Router } from "express";
import {
  ChatRequest,
  isAnthropicModel,
  streamOpenAI,
  streamAnthropic,
} from "../lib/providers.js";

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

chatRouter.get("/models", (_req, res) => {
  res.json(MODELS);
});

chatRouter.post("/chat", async (req, res) => {
  const body: ChatRequest = req.body;

  if (!body.messages || !body.model) {
    res.status(400).json({ error: "messages and model are required" });
    return;
  }

  try {
    if (isAnthropicModel(body.model)) {
      await streamAnthropic(body, res);
    } else {
      await streamOpenAI(body, res);
    }
  } catch (err: any) {
    console.error("Chat error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});
