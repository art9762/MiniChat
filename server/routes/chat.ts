import { Router } from "express";
import {
  ChatRequest,
  ChatMessage,
  ContentBlock,
  isAnthropicModel,
  streamOpenAI,
  streamAnthropic,
  callWithTools,
  ToolDef,
} from "../lib/providers.js";
import { tavilySearch } from "../lib/websearch.js";
import { requireAuth } from "../lib/auth.js";
import { db } from "../lib/db.js";
import { calcCost, estimateInputTokens, priceOf } from "../lib/pricing.js";
import { chatLimiter } from "../lib/rateLimit.js";
import { retrieve, buildContextBlock } from "../lib/rag.js";
import { getMember } from "./projects.js";
import { updateProjectMemory } from "../lib/memory.js";
import fs from "fs";

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
  const body: ChatRequest & { projectId?: string; chatId?: string; attachmentIds?: string[]; webSearch?: boolean } = req.body;

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
    if (!m || (typeof m.content !== "string" && !Array.isArray(m.content)) || !['user','assistant','system'].includes(m.role)) {
      return res.status(400).json({ error: "invalid message shape" });
    }
    totalChars += typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length;
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
      const query = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";

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

  // --- Attachment injection -----------------------------------------------
  // Build multimodal content for the last user message if attachmentIds are provided.
  let messagesWithAttachments = [...body.messages];
  if (Array.isArray(body.attachmentIds) && body.attachmentIds.length > 0 && body.chatId) {
    // Validate attachments belong to this chat and were uploaded by the current user
    const placeholders = body.attachmentIds.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, name, mime_type, size_bytes, storage_path, text_content, uploaded_by, chat_id
                FROM chat_attachments WHERE id IN (${placeholders}) AND chat_id = ? AND uploaded_by = ?`)
      .all(...body.attachmentIds, body.chatId, user.id) as any[];

    if (rows.length !== body.attachmentIds.length) {
      return res.status(400).json({ error: "some attachments not found or wrong chat" });
    }

    // Build content blocks
    const textParts: string[] = [];
    const imageBlocks: ContentBlock[] = [];

    for (const row of rows) {
      if (row.mime_type.startsWith("image/")) {
        // Vision block
        const buf = fs.readFileSync(row.storage_path);
        const b64 = buf.toString("base64");
        imageBlocks.push({ type: "_image", mime_type: row.mime_type, b64, name: row.name });
      } else if (row.text_content) {
        const truncated = row.text_content.length > 50000 ? row.text_content.slice(0, 50000) + "\n[...truncated]" : row.text_content;
        textParts.push(`[Attached: ${row.name}]\n${truncated}`);
      }
    }

    // Find last user message index
    const lastUserIdx = messagesWithAttachments.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx >= 0 && (textParts.length > 0 || imageBlocks.length > 0)) {
      const lastMsg = messagesWithAttachments[lastUserIdx];
      const baseText = (textParts.length > 0 ? textParts.join("\n\n") + "\n\n" : "") + (typeof lastMsg.content === "string" ? lastMsg.content : "");

      if (isAnthropicModel(body.model)) {
        // Anthropic multimodal format
        const contentBlocks: ContentBlock[] = [];
        for (const img of imageBlocks) {
          const { b64, mime_type } = img as any;
          contentBlocks.push({
            type: "image",
            source: { type: "base64", media_type: mime_type, data: b64 },
          });
        }
        contentBlocks.push({ type: "text", text: baseText });
        messagesWithAttachments = [
          ...messagesWithAttachments.slice(0, lastUserIdx),
          { ...lastMsg, content: contentBlocks } as any,
          ...messagesWithAttachments.slice(lastUserIdx + 1),
        ];
      } else {
        // OpenAI multimodal format
        const contentBlocks: ContentBlock[] = [
          { type: "text", text: baseText },
        ];
        for (const img of imageBlocks) {
          const { b64, mime_type } = img as any;
          contentBlocks.push({
            type: "image_url",
            image_url: { url: `data:${mime_type};base64,${b64}` },
          });
        }
        messagesWithAttachments = [
          ...messagesWithAttachments.slice(0, lastUserIdx),
          { ...lastMsg, content: contentBlocks } as any,
          ...messagesWithAttachments.slice(lastUserIdx + 1),
        ];
      }
    }
  }

  // --- Balance hold (prevents free-Opus race) ------------------------------
  // Estimate maximum possible cost: actual input tokens + max_output_tokens at this model's price.
  // Atomically reserve from the balance; refund the difference after the stream.
  const approxInput = messagesWithAttachments.reduce((s, m) => s + estimateInputTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content)), 0)
    + (projectSystemPrompt ? estimateInputTokens(projectSystemPrompt) : 0)
    + (body.systemPrompt ? estimateInputTokens(body.systemPrompt) : 0);
  const hold = Math.max(1, calcCost(body.model, approxInput, MAX_OUTPUT_TOKENS)) * (body.webSearch ? 2 : 1);

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
  let accumulatedUsage: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 };

  // Capture last user message for memory hook
  const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user")?.content;
  const lastUserMsgText = typeof lastUserMsg === "string" ? lastUserMsg : "";

  const settle = (usage: { inputTokens: number; outputTokens: number } | null) => {
    if (finalized) return;
    finalized = true;
    const merged = usage
      ? {
          inputTokens: accumulatedUsage.inputTokens + usage.inputTokens,
          outputTokens: accumulatedUsage.outputTokens + usage.outputTokens,
        }
      : accumulatedUsage;
    const actualCost = calcCost(body.model, merged.inputTokens, merged.outputTokens);
    const delta = hold - actualCost; // positive => refund, negative => additional charge

    const tx = db.transaction(() => {
      // Refund (or charge) the difference. A negative delta would charge more than was held.
      db.prepare(
        `UPDATE users SET token_balance = MAX(0, token_balance + ?) WHERE id = ?`
      ).run(delta, user.id);
      db.prepare(
        `INSERT INTO usage_log (user_id, model, input_tokens, output_tokens, cost, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(user.id, body.model, merged.inputTokens, merged.outputTokens, actualCost, Date.now());
    });
    tx();

    const balance = (db.prepare(`SELECT token_balance FROM users WHERE id = ?`).get(user.id) as any)
      .token_balance as number;

    if (!res.headersSent) {
      res.json({ usage: { ...merged, cost: actualCost, balance } });
    } else {
      res.write(`data: ${JSON.stringify({ usage: { ...merged, cost: actualCost, balance } })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
    }

    // Fire-and-forget memory update after stream completes
    if (usage && body.projectId && assistantBuffer) {
      updateProjectMemory(body.projectId, user.id, lastUserMsgText, assistantBuffer)
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

  const WEB_SEARCH_TOOL: ToolDef = {
    name: "web_search",
    description: "Search the web for current information, news, facts after the knowledge cutoff. Use when the user asks about recent events, current data, or specific URLs.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Search query" } }, required: ["query"] },
  };

  try {
    const effectiveBody = projectSystemPrompt
      ? { ...body, messages: messagesWithAttachments, systemPrompt: projectSystemPrompt }
      : { ...body, messages: messagesWithAttachments };

    const useWebSearch = body.webSearch === true && !!process.env.TAVILY_API_KEY;

    if (useWebSearch) {
      // Phase 1: non-streaming call with tool
      const webSearchSystem = "You have access to a web_search tool. When the user asks about anything that may require current/online information, call web_search immediately. Do not announce that you will search — just call the tool. After receiving results, answer based on them and cite sources.";
      const phase1Body = {
        ...effectiveBody,
        systemPrompt: effectiveBody.systemPrompt
          ? `${effectiveBody.systemPrompt}\n\n${webSearchSystem}`
          : webSearchSystem,
      };
      const phase1 = await callWithTools(phase1Body, [WEB_SEARCH_TOOL]);
      accumulatedUsage.inputTokens += phase1.usage.inputTokens;
      accumulatedUsage.outputTokens += phase1.usage.outputTokens;

      if (phase1.toolCalls.length > 0) {
        // Emit tool use events to client
        for (const tc of phase1.toolCalls) {
          res.write(`data: ${JSON.stringify({ toolUse: { name: tc.name, query: tc.arguments?.query || "" } })}\n\n`);
        }

        // Execute searches in parallel
        const searchResults = await Promise.all(
          phase1.toolCalls.map(async (tc) => {
            try {
              return { tc, result: await tavilySearch(tc.arguments?.query || "") };
            } catch (e: any) {
              console.error("[websearch] error:", e?.message);
              return { tc, result: { answer: null, results: [] } };
            }
          })
        );

        // Emit tool result events (just metadata)
        for (const { tc, result } of searchResults) {
          res.write(`data: ${JSON.stringify({ toolResult: { name: tc.name, results: result.results.map((r) => ({ url: r.url, title: r.title })) } })}\n\n`);
        }

        // Build extended messages for phase 2
        let phase2Messages: typeof messagesWithAttachments;
        if (isAnthropicModel(body.model)) {
          // Anthropic: assistant message with tool_use blocks + user message with tool_result
          const assistantContent: any[] = phase1.toolCalls.map((tc) => ({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          }));
          if (phase1.text) assistantContent.unshift({ type: "text", text: phase1.text });

          const toolResultContent: any[] = searchResults.map(({ tc, result }) => ({
            type: "tool_result",
            tool_use_id: tc.id,
            content: [
              ...(result.answer ? [{ type: "text", text: `Answer: ${result.answer}` }] : []),
              ...result.results.map((r) => ({ type: "text", text: `[${r.title}](${r.url})\n${r.content}` })),
            ],
          }));

          phase2Messages = [
            ...effectiveBody.messages,
            { role: "assistant" as const, content: assistantContent },
            { role: "user" as const, content: toolResultContent },
          ];
        } else {
          // OpenAI: assistant message with tool_calls + tool messages
          const assistantMsg: any = {
            role: "assistant",
            content: phase1.text || null,
            tool_calls: phase1.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          };
          const toolMsgs: any[] = searchResults.map(({ tc, result }) => ({
            role: "tool",
            tool_call_id: tc.id,
            content: [
              result.answer ? `Answer: ${result.answer}` : "",
              ...result.results.map((r) => `[${r.title}](${r.url})\n${r.content}`),
            ].filter(Boolean).join("\n\n"),
          }));
          phase2Messages = [...effectiveBody.messages, assistantMsg, ...toolMsgs];
        }

        const phase2Body = { ...effectiveBody, messages: phase2Messages };
        if (isAnthropicModel(body.model)) {
          await streamAnthropic(phase2Body, cb);
        } else {
          await streamOpenAI(phase2Body, cb);
        }
      } else {
        // No tool calls — phase1 text is the answer, emit as chunks
        if (phase1.text) cb.onContent(phase1.text);
        cb.onDone({ inputTokens: 0, outputTokens: 0 });
      }
    } else {
      if (isAnthropicModel(body.model)) {
        await streamAnthropic(effectiveBody, cb);
      } else {
        await streamOpenAI(effectiveBody, cb);
      }
    }
  } catch (err: any) {
    cb.onError(500, err?.message || "internal error");
  }
});

// suppress unused import warnings in environments where priceOf isn't used directly here
void priceOf;
