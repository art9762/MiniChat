// ADR-002: Agent billing proxy.
//
// The Claude Code CLI inside a user's container is pointed at this router via
// ANTHROPIC_BASE_URL=.../api/agent-proxy and ANTHROPIC_API_KEY=<wsk_ workspace
// token>. We authenticate the workspace token (bcrypt vs workspaces.ws_token_hash),
// check / hold the owning user's balance, forward verbatim to Trinity aurora with
// the *real* key, capture usage from the SSE stream (or JSON), and settle the hold
// exactly like routes/chat.ts. Trinity keys never leave the server.
//
// ⚠️ MOUNT ORDER: this router parses its own (large) JSON body. The global
// `express.json({limit:"256kb"})` in index.ts MUST NOT run for /api/agent-proxy
// (agent payloads exceed 256kb and a prior parser would consume the stream).
// Mount agentProxyRouter BEFORE the global json middleware, or have the global
// json skip the /api/agent-proxy path.

import { Router } from "express";
import express from "express";
import bcrypt from "bcryptjs";
import { db, User, Workspace } from "../lib/db.js";
import { calcCost } from "../lib/pricing.js";
import { agentProxyLimiter } from "../lib/rateLimit.js";

export const agentProxyRouter = Router();

// Agent payloads (full conversation + tool results) can be large.
agentProxyRouter.use(express.json({ limit: "20mb" }));

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

// Resolve the owning user from a workspace token (x-api-key). Users are few, so a
// linear bcrypt scan is acceptable. Returns null if no workspace token matches.
function resolveWorkspaceUser(token: string): User | null {
  if (!token) return null;
  const rows = db
    .prepare(`SELECT * FROM workspaces WHERE ws_token_hash IS NOT NULL`)
    .all() as Workspace[];
  for (const w of rows) {
    if (w.ws_token_hash && bcrypt.compareSync(token, w.ws_token_hash)) {
      return db.prepare(`SELECT * FROM users WHERE id = ?`).get(w.user_id) as User | undefined ?? null;
    }
  }
  return null;
}

type Usage = { inputTokens: number; outputTokens: number };

// Parse an Anthropic SSE chunk buffer for usage info (message_start sets input,
// message_delta updates output). Mirrors lib/providers.ts streamAnthropic.
function scanSseForUsage(text: string, usage: Usage) {
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === "message_start") {
        const u = parsed.message?.usage;
        if (u) {
          if (typeof u.input_tokens === "number") usage.inputTokens = u.input_tokens;
          if (typeof u.output_tokens === "number") usage.outputTokens = u.output_tokens;
        }
      } else if (parsed.type === "message_delta") {
        const u = parsed.usage;
        if (u) {
          if (typeof u.output_tokens === "number") usage.outputTokens = u.output_tokens;
          if (typeof u.input_tokens === "number") usage.inputTokens = u.input_tokens;
        }
      }
    } catch {
      // partial / non-JSON data line — ignore
    }
  }
}

agentProxyRouter.post("/v1/messages", agentProxyLimiter, async (req, res) => {
  const token = req.header("x-api-key") || "";
  const user = resolveWorkspaceUser(token);
  if (!user) {
    return res.status(401).json({ type: "error", error: { type: "authentication_error", message: "invalid api key" } });
  }
  if (user.status === "banned" || user.status === "suspended") {
    return res.status(403).json({ type: "error", error: { type: "permission_error", message: user.status } });
  }
  if (user.token_balance <= 0) {
    return res.status(402).json({ type: "error", error: { type: "billing_error", message: "insufficient balance" } });
  }

  const body = req.body;
  if (!body || typeof body !== "object" || !body.model) {
    return res.status(400).json({ type: "error", error: { type: "invalid_request_error", message: "model required" } });
  }
  const model: string = body.model;
  const isStream = body.stream === true;

  // --- Balance hold (mirrors routes/chat.ts) ------------------------------
  const approxInput = Math.ceil(
    ((typeof body.system === "string" ? body.system.length : JSON.stringify(body.system ?? "").length) +
      JSON.stringify(body.messages ?? []).length) / 4
  );
  const maxOut = typeof body.max_tokens === "number" && body.max_tokens > 0 ? body.max_tokens : DEFAULT_MAX_OUTPUT_TOKENS;
  const hold = Math.max(1, calcCost(model, approxInput, maxOut));

  const holdRes = db
    .prepare(
      `UPDATE users SET token_balance = token_balance - ?
       WHERE id = ? AND token_balance >= ?`
    )
    .run(hold, user.id, hold);
  if (holdRes.changes === 0) {
    return res.status(402).json({ type: "error", error: { type: "billing_error", message: "insufficient balance for this request" } });
  }

  let finalized = false;
  const settle = (usage: Usage | null) => {
    if (finalized) return;
    finalized = true;
    const actual = usage ?? { inputTokens: 0, outputTokens: 0 };
    const actualCost = calcCost(model, actual.inputTokens, actual.outputTokens);
    const delta = hold - actualCost; // + => refund, - => extra charge
    const tx = db.transaction(() => {
      db.prepare(`UPDATE users SET token_balance = MAX(0, token_balance + ?) WHERE id = ?`).run(delta, user.id);
      db.prepare(
        `INSERT INTO usage_log (user_id, model, input_tokens, output_tokens, cost, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(user.id, model, actual.inputTokens, actual.outputTokens, actualCost, Date.now());
    });
    tx();
  };
  const refundFull = () => {
    if (finalized) return;
    finalized = true;
    db.prepare(`UPDATE users SET token_balance = token_balance + ? WHERE id = ?`).run(hold, user.id);
  };

  // If the CLI disconnects before we finished, refund the hold.
  req.on("close", () => {
    if (!res.writableEnded) refundFull();
  });

  // --- Forward to Trinity aurora ------------------------------------------
  const upstreamUrl = `${process.env.TRINITY_ANTHROPIC_URL}/messages`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": process.env.TRINITY_ANTHROPIC_KEY || "",
    "anthropic-version": req.header("anthropic-version") || "2023-06-01",
  };
  const beta = req.header("anthropic-beta");
  if (beta) headers["anthropic-beta"] = beta;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    console.error("[agent-proxy] upstream fetch failed:", err?.message || err);
    refundFull();
    return res.status(502).json({ type: "error", error: { type: "api_error", message: "upstream unreachable" } });
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    console.error(`[agent-proxy] upstream ${upstream.status}:`, errText.slice(0, 500));
    refundFull();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    return res.send(errText || JSON.stringify({ type: "error", error: { type: "api_error", message: "upstream error" } }));
  }

  const usage: Usage = { inputTokens: 0, outputTokens: 0 };

  if (isStream) {
    // Faithful passthrough: write raw upstream bytes to the CLI immediately,
    // while tee-parsing the SSE for usage.
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let sseBuf = ""; // text buffer for usage scanning (split on complete lines)
    let sawErrorEvent = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          // Passthrough verbatim (raw bytes, no re-encoding).
          res.write(Buffer.from(value));
          // Tee-parse for usage: accumulate text, scan only complete lines so a
          // `data:` line split across chunks isn't dropped.
          sseBuf += decoder.decode(value, { stream: true });
          const nl = sseBuf.lastIndexOf("\n");
          if (nl >= 0) {
            const ready = sseBuf.slice(0, nl + 1);
            sseBuf = sseBuf.slice(nl + 1);
            scanSseForUsage(ready, usage);
            if (ready.includes('"type":"error"') || ready.includes('"type": "error"')) sawErrorEvent = true;
          }
        }
      }
    } catch (err: any) {
      console.error("[agent-proxy] stream read error:", err?.message || err);
    }
    // Scan any trailing buffered text.
    if (sseBuf) {
      scanSseForUsage(sseBuf, usage);
      if (sseBuf.includes('"type":"error"')) sawErrorEvent = true;
    }

    if (sawErrorEvent && usage.inputTokens === 0 && usage.outputTokens === 0) {
      // Upstream emitted an error event mid-stream with no usage — refund.
      refundFull();
    } else {
      settle(usage);
    }
    if (!res.writableEnded) res.end();
    return;
  }

  // Non-streaming: read JSON, extract usage, forward as-is.
  const json: any = await upstream.json().catch(() => null);
  if (json && json.usage) {
    usage.inputTokens = json.usage.input_tokens ?? 0;
    usage.outputTokens = json.usage.output_tokens ?? 0;
  }
  settle(usage);
  res.status(upstream.status).json(json ?? { type: "error", error: { type: "api_error", message: "empty upstream response" } });
});
