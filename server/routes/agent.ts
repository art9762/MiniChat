// Agent REST routes (session CRUD + event history) and the WebSocket runner.
//
// REST: mounted at /api/agent (requireAuth). WS: attachAgentWss(server) wires a
// noServer WebSocketServer onto the existing http.Server for path /api/agent/ws,
// authenticating via the mc_sid cookie (ADR-004).

import { Router } from "express";
import type http from "http";
import { URL } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { requireAuth, getUserBySession, COOKIE_NAME } from "../lib/auth.js";
import type { AgentClientMessage, AgentServerMessage, AgentSessionDTO } from "../lib/agentTypes.js";
import {
  createSession,
  listSessions,
  getSession,
  deleteSession,
  listEvents,
  runAgent,
  type RunHandle,
} from "../lib/agent.js";
import type { AgentSession } from "../lib/db.js";

export const agentRouter = Router();

function toDTO(s: AgentSession): AgentSessionDTO {
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

agentRouter.get("/sessions", requireAuth, (req, res) => {
  res.json(listSessions(req.user!.id).map(toDTO));
});

agentRouter.post("/sessions", requireAuth, (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.slice(0, 200) : undefined;
  const s = createSession(req.user!.id, title);
  res.status(201).json(toDTO(s));
});

agentRouter.delete("/sessions/:id", requireAuth, (req, res) => {
  const ok = deleteSession(req.user!.id, String(req.params.id));
  if (!ok) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

agentRouter.get("/sessions/:id/events", requireAuth, (req, res) => {
  const s = getSession(req.user!.id, String(req.params.id));
  if (!s) return res.status(404).json({ error: "not found" });
  const events = listEvents(s.id).map((e) => ({
    id: e.id,
    type: e.type,
    payload: e.payload_json ? safeParse(e.payload_json) : null,
    createdAt: e.created_at,
  }));
  res.json({ session: toDTO(s), events });
});

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ── WebSocket: /api/agent/ws?session=<id> ────────────────────────────────────

let wss: WebSocketServer | null = null;

// Parse a single cookie value out of a Cookie header.
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

// Idempotent: safe to call once after the http server is created.
export function attachAgentWss(server: http.Server): void {
  if (wss) return;
  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(request.url || "", "http://localhost").pathname;
    } catch {
      return;
    }
    // Only handle our path; leave other upgrades (e.g. Vite HMR) untouched.
    if (pathname !== "/api/agent/ws") return;

    const url = new URL(request.url || "", "http://localhost");
    const sid = readCookie(request.headers.cookie, COOKIE_NAME);
    const user = sid ? getUserBySession(sid) : undefined;
    if (!user || user.status === "banned" || user.status === "suspended") {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const sessionId = url.searchParams.get("session") || "";
    const session = getSession(user.id, sessionId);
    if (!session) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    wss!.handleUpgrade(request, socket, head, (ws) => {
      wss!.emit("connection", ws, request, { userId: user.id, sessionId: session.id });
    });
  });

  wss.on("connection", (ws: WebSocket, _request: http.IncomingMessage, ctx: { userId: string; sessionId: string }) => {
    let activeRun: RunHandle | null = null;

    const send = (msg: AgentServerMessage) => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify(msg));
        } catch {}
      }
    };

    ws.on("message", (raw) => {
      let msg: AgentClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send({ type: "error", message: "invalid message" });
        return;
      }

      if (msg.type === "cancel") {
        activeRun?.cancel();
        return;
      }

      if (msg.type === "prompt") {
        if (activeRun) {
          send({ type: "error", message: "a run is already in progress" });
          return;
        }
        const text = typeof msg.text === "string" ? msg.text : "";
        if (!text.trim()) {
          send({ type: "error", message: "empty prompt" });
          return;
        }
        // Re-fetch user + session fresh (balance / cli_session_id may have changed
        // since the connection opened).
        const freshUser = resolveUser(ctx.userId);
        const session = getSession(ctx.userId, ctx.sessionId);
        if (!freshUser || !session) {
          send({ type: "error", message: "session no longer available", code: 404 });
          return;
        }
        activeRun = runAgent({
          user: freshUser,
          session,
          prompt: text,
          model: typeof msg.model === "string" ? msg.model : undefined,
          onEvent: send,
        });
        activeRun.done.finally(() => {
          activeRun = null;
        });
        return;
      }

      send({ type: "error", message: "unknown message type" });
    });

    ws.on("close", () => {
      activeRun?.cancel();
    });
    ws.on("error", () => {
      activeRun?.cancel();
    });
  });
}

// helpers using db directly to avoid importing the whole auth surface twice
import { db } from "../lib/db.js";
import type { User } from "../lib/db.js";

function resolveUser(userId: string): User | null {
  return (db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as User | undefined) ?? null;
}

