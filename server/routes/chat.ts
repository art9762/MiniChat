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
import { fetchUrl } from "../lib/urlfetch.js";
import { execCode } from "../lib/codeexec.js";
import { requireAuth } from "../lib/auth.js";
import { db } from "../lib/db.js";
import { calcCost, estimateInputTokens, priceOf } from "../lib/pricing.js";
import { chatLimiter } from "../lib/rateLimit.js";
import { retrieve, buildContextBlock } from "../lib/rag.js";
import { getMember } from "./projects.js";
import { updateProjectMemory } from "../lib/memory.js";
import { variantPath, type ImageResolution, DEFAULT_RESOLUTION } from "../lib/images.js";
import { searchProjectImages, loadProjectImageVariant } from "../lib/projectImages.js";
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
const MAX_OUTPUT_TOKENS = 4096;

const ALLOWED_RESOLUTIONS: ImageResolution[] = ["low", "medium", "high"];

type AttachmentRef = string | { id: string; resolution?: ImageResolution };

function normalizeAttachmentRefs(input: unknown): { id: string; resolution: ImageResolution }[] {
  if (!Array.isArray(input)) return [];
  const out: { id: string; resolution: ImageResolution }[] = [];
  for (const ref of input as AttachmentRef[]) {
    if (typeof ref === "string") {
      out.push({ id: ref, resolution: DEFAULT_RESOLUTION });
    } else if (ref && typeof ref === "object" && typeof (ref as any).id === "string") {
      const r = (ref as any).resolution;
      const resolution: ImageResolution = ALLOWED_RESOLUTIONS.includes(r) ? r : DEFAULT_RESOLUTION;
      out.push({ id: (ref as any).id, resolution });
    }
  }
  return out;
}

chatRouter.get("/models", requireAuth, (_req, res) => {
  res.json(MODELS);
});

chatRouter.post("/chat", chatLimiter, requireAuth, async (req, res) => {
  const body: ChatRequest & {
    projectId?: string;
    chatId?: string;
    attachmentIds?: AttachmentRef[];
    webSearch?: boolean;
    urlFetch?: boolean;
    codeExec?: boolean;
  } = req.body;

  if (!body.model || !MODEL_IDS.has(body.model)) {
    return res.status(400).json({ error: "invalid model" });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: "messages required" });
  }
  if (body.messages.length > MAX_MESSAGES) {
    return res.status(413).json({ error: `too many messages (>${MAX_MESSAGES})` });
  }

  let totalChars = 0;
  for (const m of body.messages) {
    if (typeof m.content !== "string") return res.status(400).json({ error: "message content must be string" });
    totalChars += m.content.length;
  }
  if (body.systemPrompt && typeof body.systemPrompt === "string") {
    totalChars += body.systemPrompt.length;
  }

  let projectSystemPrompt = "";
  if (body.projectId) {
    const user = req.user!;
    const membership = getMember(body.projectId, user.id);
    if (!membership) {
      return res.status(403).json({ error: "not a member of this project" });
    }

    const project = db.prepare(`SELECT master_prompt, memory FROM projects WHERE id = ?`).get(body.projectId) as
      | { master_prompt: string | null; memory: string | null }
      | undefined;

    if (project) {
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

  // ── Attachment injection ────────────────────────────────────────────────
  let messagesWithAttachments = [...body.messages];
  const attachmentRefs = normalizeAttachmentRefs(body.attachmentIds);
  if (attachmentRefs.length > 0 && body.chatId) {
    const ids = attachmentRefs.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, name, mime_type, size_bytes, storage_path, text_content, has_variants, uploaded_by, chat_id
                FROM chat_attachments WHERE id IN (${placeholders}) AND chat_id = ? AND uploaded_by = ?`)
      .all(...ids, body.chatId, user.id) as any[];

    if (rows.length !== ids.length) {
      return res.status(400).json({ error: "some attachments not found or wrong chat" });
    }

    // Map rows by id for resolution lookup
    const refById = new Map(attachmentRefs.map((r) => [r.id, r.resolution]));

    const textParts: string[] = [];
    const imageBlocks: { b64: string; mime_type: string; name: string }[] = [];

    for (const row of rows) {
      if (row.mime_type.startsWith("image/")) {
        const resolution = refById.get(row.id) ?? DEFAULT_RESOLUTION;
        const useVariant = row.has_variants ? resolution : "original";
        const p = row.has_variants ? variantPath(row.storage_path, useVariant) : row.storage_path;
        const buf = fs.readFileSync(p);
        const mime = useVariant === "original" ? row.mime_type : "image/webp";
        imageBlocks.push({ b64: buf.toString("base64"), mime_type: mime, name: row.name });
      } else if (row.text_content) {
        const truncated = row.text_content.length > 50000 ? row.text_content.slice(0, 50000) + "\n[...truncated]" : row.text_content;
        textParts.push(`[Attached: ${row.name}]\n${truncated}`);
      }
    }

    const lastUserIdx = messagesWithAttachments.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx >= 0 && (textParts.length > 0 || imageBlocks.length > 0)) {
      const lastMsg = messagesWithAttachments[lastUserIdx];
      const baseText = (textParts.length > 0 ? textParts.join("\n\n") + "\n\n" : "") + (typeof lastMsg.content === "string" ? lastMsg.content : "");

      if (isAnthropicModel(body.model)) {
        const contentBlocks: ContentBlock[] = [];
        for (const img of imageBlocks) {
          contentBlocks.push({
            type: "image",
            source: { type: "base64", media_type: img.mime_type, data: img.b64 },
          });
        }
        contentBlocks.push({ type: "text", text: baseText });
        messagesWithAttachments = [
          ...messagesWithAttachments.slice(0, lastUserIdx),
          { ...lastMsg, content: contentBlocks } as any,
          ...messagesWithAttachments.slice(lastUserIdx + 1),
        ];
      } else {
        const contentBlocks: ContentBlock[] = [{ type: "text", text: baseText }];
        for (const img of imageBlocks) {
          contentBlocks.push({
            type: "image_url",
            image_url: { url: `data:${img.mime_type};base64,${img.b64}` },
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

  // ── Balance hold ───────────────────────────────────────────────────────────────
  const approxInput =
    messagesWithAttachments.reduce((s, m) => s + estimateInputTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content)), 0) +
    (projectSystemPrompt ? estimateInputTokens(projectSystemPrompt) : 0) +
    (body.systemPrompt ? estimateInputTokens(body.systemPrompt) : 0);
  const hold = Math.max(1, calcCost(body.model, approxInput, MAX_OUTPUT_TOKENS)) * ((body.webSearch || body.urlFetch || body.codeExec || body.projectId) ? 3 : 1);

  const holdRes = db
    .prepare(`UPDATE users SET token_balance = token_balance - ? WHERE id = ? AND token_balance >= ?`)
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
    const delta = hold - actualCost;

    const tx = db.transaction(() => {
      db.prepare(`UPDATE users SET token_balance = MAX(0, token_balance + ?) WHERE id = ?`).run(delta, user.id);
      db.prepare(
        `INSERT INTO usage_log (user_id, model, input_tokens, output_tokens, cost, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(user.id, body.model, merged.inputTokens, merged.outputTokens, actualCost, Date.now());
    });
    tx();

    const balance = (db.prepare(`SELECT token_balance FROM users WHERE id = ?`).get(user.id) as any).token_balance as number;

    if (!res.headersSent) {
      res.json({ usage: { ...merged, cost: actualCost, balance } });
    } else {
      res.write(`data: ${JSON.stringify({ usage: { ...merged, cost: actualCost, balance } })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
    }

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
      console.error(`[upstream ${status}]`, message);
      if (finalized) return;
      finalized = true;
      db.prepare(`UPDATE users SET token_balance = token_balance + ? WHERE id = ?`).run(hold, user.id);
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

  req.on("close", () => {
    if (finalized) return;
    finalized = true;
    db.prepare(`UPDATE users SET token_balance = token_balance + ? WHERE id = ?`).run(hold, user.id);
  });

  // ── Tool definitions ───────────────────────────────────────────────────────────
  const WEB_SEARCH_TOOL: ToolDef = {
    name: "web_search",
    description: "Search the web for current information, news, facts after the knowledge cutoff.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Search query" } }, required: ["query"] },
  };
  const URL_FETCH_TOOL: ToolDef = {
    name: "url_fetch",
    description: "Fetch the content of a URL.",
    parameters: { type: "object", properties: { url: { type: "string", description: "The URL to fetch" } }, required: ["url"] },
  };
  const CODE_EXEC_TOOL: ToolDef = {
    name: "code_exec",
    description: "Execute Python or JavaScript code in a secure sandbox.",
    parameters: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["python", "javascript"] },
        code: { type: "string" },
      },
      required: ["language", "code"],
    },
  };
  const SEARCH_IMAGES_TOOL: ToolDef = {
    name: "search_project_images",
    description:
      "Search images stored in this project by filename, MIME type, file size, or upload date. Returns metadata only — NO image data. Use this first to find candidates, then call view_project_image with the chosen id(s) to actually see them.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring(s) to match against filename (case-insensitive, AND across whitespace-separated tokens)" },
        mimeType: { type: "string", description: "e.g. image/png, image/jpeg, image/webp" },
        minSize: { type: "number", description: "Minimum size in bytes" },
        maxSize: { type: "number", description: "Maximum size in bytes" },
        uploadedAfter: { type: "number", description: "Unix ms timestamp" },
        uploadedBefore: { type: "number", description: "Unix ms timestamp" },
        limit: { type: "number", description: "Max results (1-50, default 20)" },
      },
    },
  };
  const VIEW_IMAGE_TOOL: ToolDef = {
    name: "view_project_image",
    description:
      "Load a project image so you can actually look at it. The image will be attached to your next reasoning step. Use resolution=low for quick scans, medium (default) for most cases, high only when you need detail.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Image id returned by search_project_images" },
        resolution: { type: "string", enum: ["low", "medium", "high"], description: "Detail level (default medium)" },
      },
      required: ["id"],
    },
  };

  try {
    const effectiveBody = projectSystemPrompt
      ? { ...body, messages: messagesWithAttachments, systemPrompt: projectSystemPrompt }
      : { ...body, messages: messagesWithAttachments };

    const useWebSearch = body.webSearch === true && !!process.env.TAVILY_API_KEY;
    const useUrlFetch = body.urlFetch === true;
    const useCodeExec = body.codeExec === true;
    const useProjectImages = !!body.projectId;

    const activeTools: ToolDef[] = [];
    if (useWebSearch) activeTools.push(WEB_SEARCH_TOOL);
    if (useUrlFetch) activeTools.push(URL_FETCH_TOOL);
    if (useCodeExec) activeTools.push(CODE_EXEC_TOOL);
    if (useProjectImages) {
      activeTools.push(SEARCH_IMAGES_TOOL);
      activeTools.push(VIEW_IMAGE_TOOL);
    }

    if (activeTools.length === 0) {
      if (isAnthropicModel(body.model)) await streamAnthropic(effectiveBody, cb);
      else await streamOpenAI(effectiveBody, cb);
      return;
    }

    // ── Tool loop (up to 4 iterations) ─────────────────────────────────────────────────
    const toolSystemParts: string[] = [];
    if (useWebSearch) toolSystemParts.push("You have access to a web_search tool. Call it for any current/online information needs.");
    if (useUrlFetch) toolSystemParts.push("You have access to a url_fetch tool. Call it when the user shares a link or asks to read a webpage.");
    if (useCodeExec) toolSystemParts.push("You have access to a code_exec tool. Call it for calculations, data analysis, or testing snippets.");
    if (useProjectImages) toolSystemParts.push(
      "This is a project conversation. The project may contain images. To see them, you MUST use the two-step flow: " +
        "(1) call search_project_images with filters (query/mime/size/date) to find candidates — it returns metadata only; " +
        "(2) call view_project_image with the id you want to look at. Pick resolution=low for quick scans, medium for most cases, high only for fine detail. " +
        "Do not assume a project image exists — search first."
    );
    const toolSystem = toolSystemParts.join("\n");

    let loopMessages = messagesWithAttachments;
    const MAX_TOOL_ITERATIONS = 4;

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const phaseBody = {
        ...effectiveBody,
        messages: loopMessages,
        systemPrompt: (effectiveBody.systemPrompt ? effectiveBody.systemPrompt + "\n\n" : "") + toolSystem,
      };
      const phase = await callWithTools(phaseBody, activeTools);
      accumulatedUsage.inputTokens += phase.usage.inputTokens;
      accumulatedUsage.outputTokens += phase.usage.outputTokens;

      if (phase.toolCalls.length === 0) {
        // No more tool calls — emit final text and finish
        if (phase.text) cb.onContent(phase.text);
        cb.onDone({ inputTokens: 0, outputTokens: 0 });
        return;
      }

      // Emit tool-use events to client
      for (const tc of phase.toolCalls) {
        const arg = tc.arguments || {};
        const summary =
          tc.name === "search_project_images" ? (arg.query || JSON.stringify(arg)) :
          tc.name === "view_project_image" ? `image:${arg.id} (${arg.resolution || "medium"})` :
          (arg.query || arg.url || "");
        res.write(`data: ${JSON.stringify({ toolUse: { name: tc.name, query: summary } })}\n\n`);
      }

      // Execute tool calls in parallel
      type ToolResult =
        | { kind: "web_search"; tc: any; webResult: { answer: string | null; results: { url: string; title: string; content: string }[] } }
        | { kind: "url_fetch"; tc: any; urlResult: { url: string; title: string; content: string } }
        | { kind: "code_exec"; tc: any; codeResult: { stdout: string; stderr: string; exitCode: number; durationMs: number; timedOut: boolean } }
        | { kind: "search_project_images"; tc: any; rows: any[] }
        | { kind: "view_project_image"; tc: any; image: { b64: string; mimeType: string; name: string; width: number | null; height: number | null } | null; resolution: ImageResolution; imageId: string };

      const toolResults: ToolResult[] = await Promise.all(
        phase.toolCalls.map(async (tc): Promise<ToolResult> => {
          try {
            switch (tc.name) {
              case "web_search": {
                const r = await tavilySearch(tc.arguments?.query || "");
                return { kind: "web_search", tc, webResult: r };
              }
              case "url_fetch": {
                const r = await fetchUrl(tc.arguments?.url || "");
                return { kind: "url_fetch", tc, urlResult: r };
              }
              case "code_exec": {
                const r = await execCode(tc.arguments?.language || "python", tc.arguments?.code || "");
                return { kind: "code_exec", tc, codeResult: r };
              }
              case "search_project_images": {
                if (!body.projectId) return { kind: "search_project_images", tc, rows: [] };
                const rows = searchProjectImages(body.projectId, tc.arguments || {});
                return { kind: "search_project_images", tc, rows };
              }
              case "view_project_image": {
                if (!body.projectId) return { kind: "view_project_image", tc, image: null, resolution: "medium", imageId: tc.arguments?.id || "" };
                const resolution: ImageResolution = ALLOWED_RESOLUTIONS.includes(tc.arguments?.resolution) ? tc.arguments.resolution : "medium";
                const img = loadProjectImageVariant(body.projectId, tc.arguments?.id || "", resolution);
                return { kind: "view_project_image", tc, image: img, resolution, imageId: tc.arguments?.id || "" };
              }
              default:
                throw new Error(`Unknown tool: ${tc.name}`);
            }
          } catch (e: any) {
            console.error(`[tool:${tc.name}] error:`, e?.message);
            if (tc.name === "web_search") return { kind: "web_search", tc, webResult: { answer: null, results: [] } };
            if (tc.name === "url_fetch") return { kind: "url_fetch", tc, urlResult: { url: tc.arguments?.url || "", title: "", content: `Error: ${e?.message}` } };
            if (tc.name === "code_exec") return { kind: "code_exec", tc, codeResult: { stdout: "", stderr: `Error: ${e?.message}`, exitCode: -1, durationMs: 0, timedOut: false } };
            if (tc.name === "search_project_images") return { kind: "search_project_images", tc, rows: [] };
            return { kind: "view_project_image", tc, image: null, resolution: "medium", imageId: tc.arguments?.id || "" };
          }
        })
      );

      // Emit tool-result summaries
      for (const tr of toolResults) {
        if (tr.kind === "web_search") {
          res.write(`data: ${JSON.stringify({ toolResult: { name: "web_search", results: tr.webResult.results.map((r: any) => ({ url: r.url, title: r.title })) } })}\n\n`);
        } else if (tr.kind === "url_fetch") {
          res.write(`data: ${JSON.stringify({ toolResult: { name: "url_fetch", results: [{ url: tr.urlResult.url, title: tr.urlResult.title }] } })}\n\n`);
        } else if (tr.kind === "code_exec") {
          res.write(`data: ${JSON.stringify({ toolResult: { name: "code_exec", results: [{ url: "", title: `exitCode=${tr.codeResult.exitCode} (${tr.codeResult.durationMs}ms)` }] } })}\n\n`);
        } else if (tr.kind === "search_project_images") {
          res.write(`data: ${JSON.stringify({ toolResult: { name: "search_project_images", results: tr.rows.map((r: any) => ({ url: r.id, title: `${r.name} (${r.width}×${r.height}, ${Math.round(r.size_bytes/1024)}KB)` })) } })}\n\n`);
        } else if (tr.kind === "view_project_image") {
          res.write(`data: ${JSON.stringify({ toolResult: { name: "view_project_image", results: [{ url: tr.imageId, title: tr.image ? `${tr.image.name} → ${tr.resolution}` : `image not found: ${tr.imageId}` }] } })}\n\n`);
        }
      }

      // Build phase2 messages with tool results
      if (isAnthropicModel(body.model)) {
        const assistantContent: any[] = phase.toolCalls.map((tc) => ({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        }));
        if (phase.text) assistantContent.unshift({ type: "text", text: phase.text });

        const toolResultContent: any[] = toolResults.map((tr) => {
          let content: any[];
          if (tr.kind === "web_search") {
            content = [
              ...(tr.webResult.answer ? [{ type: "text", text: `Answer: ${tr.webResult.answer}` }] : []),
              ...tr.webResult.results.map((r: any) => ({ type: "text", text: `[${r.title}](${r.url})\n${r.content}` })),
            ];
          } else if (tr.kind === "url_fetch") {
            content = [{ type: "text", text: `URL: ${tr.urlResult.url}\nTitle: ${tr.urlResult.title}\n\n${tr.urlResult.content}` }];
          } else if (tr.kind === "code_exec") {
            content = [{ type: "text", text: `exit_code: ${tr.codeResult.exitCode}\nduration_ms: ${tr.codeResult.durationMs}\nstdout:\n${tr.codeResult.stdout}\nstderr:\n${tr.codeResult.stderr}` }];
          } else if (tr.kind === "search_project_images") {
            if (tr.rows.length === 0) {
              content = [{ type: "text", text: "No matching images." }];
            } else {
              const list = tr.rows.map((r: any) => `- id=${r.id} name=${r.name} mime=${r.mime_type} size=${r.size_bytes}B dims=${r.width}×${r.height} uploaded=${new Date(r.uploaded_at).toISOString()}`).join("\n");
              content = [{ type: "text", text: `Found ${tr.rows.length} image(s):\n${list}` }];
            }
          } else {
            // view_project_image — inject vision block
            if (tr.image) {
              content = [
                { type: "image", source: { type: "base64", media_type: tr.image.mimeType, data: tr.image.b64 } },
                { type: "text", text: `Image: ${tr.image.name} (${tr.image.width}×${tr.image.height}, resolution=${tr.resolution})` },
              ];
            } else {
              content = [{ type: "text", text: `Image not found or not a project image: ${tr.imageId}` }];
            }
          }
          return { type: "tool_result", tool_use_id: tr.tc.id, content };
        });

        loopMessages = [
          ...loopMessages,
          { role: "assistant" as const, content: assistantContent },
          { role: "user" as const, content: toolResultContent },
        ];
      } else {
        // OpenAI path
        const assistantMsg: any = {
          role: "assistant",
          content: phase.text || null,
          tool_calls: phase.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        };
        const toolMsgs: any[] = toolResults.map((tr) => {
          let content: string;
          if (tr.kind === "web_search") {
            content = [
              tr.webResult.answer ? `Answer: ${tr.webResult.answer}` : "",
              ...tr.webResult.results.map((r: any) => `[${r.title}](${r.url})\n${r.content}`),
            ].filter(Boolean).join("\n\n");
          } else if (tr.kind === "url_fetch") {
            content = `URL: ${tr.urlResult.url}\nTitle: ${tr.urlResult.title}\n\n${tr.urlResult.content}`;
          } else if (tr.kind === "code_exec") {
            content = `exit_code: ${tr.codeResult.exitCode}\nduration_ms: ${tr.codeResult.durationMs}\nstdout:\n${tr.codeResult.stdout}\nstderr:\n${tr.codeResult.stderr}`;
          } else if (tr.kind === "search_project_images") {
            if (tr.rows.length === 0) content = "No matching images.";
            else content = tr.rows.map((r: any) => `- id=${r.id} name=${r.name} mime=${r.mime_type} size=${r.size_bytes}B dims=${r.width}×${r.height}`).join("\n");
          } else {
            // view_project_image on OpenAI: stuff the image as a follow-up user message via tool content (model can't see image in tool role on most providers)
            // Best-effort: provide a description; the image will be re-injected below as a user message with image_url.
            if (tr.image) content = `Image loaded: ${tr.image.name} (${tr.image.width}×${tr.image.height}, ${tr.resolution}). See attached image.`;
            else content = `Image not found: ${tr.imageId}`;
          }
          return { role: "tool", tool_call_id: tr.tc.id, content };
        });

        const followupUserMsgs: any[] = [];
        for (const tr of toolResults) {
          if (tr.kind === "view_project_image" && tr.image) {
            followupUserMsgs.push({
              role: "user",
              content: [
                { type: "text", text: `[project image ${tr.imageId} — ${tr.image.name}]` },
                { type: "image_url", image_url: { url: `data:${tr.image.mimeType};base64,${tr.image.b64}` } },
              ],
            });
          }
        }

        loopMessages = [...loopMessages, assistantMsg, ...toolMsgs, ...followupUserMsgs];
      }
    }

    // Hit MAX_TOOL_ITERATIONS without producing a final answer — do one streaming pass
    const finalBody = {
      ...effectiveBody,
      messages: loopMessages,
      systemPrompt: (effectiveBody.systemPrompt ? effectiveBody.systemPrompt + "\n\n" : "") + "Wrap up: produce a final answer for the user now.",
    };
    if (isAnthropicModel(body.model)) await streamAnthropic(finalBody, cb);
    else await streamOpenAI(finalBody, cb);
  } catch (err: any) {
    cb.onError(500, err?.message || "internal error");
  }
});

void priceOf;
