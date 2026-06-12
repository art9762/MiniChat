import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { chatRouter } from "./routes/chat.js";
import { attachmentsRouter } from "./routes/attachments.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { workspaceRouter } from "./routes/workspace.js";
import { agentRouter, attachAgentWss } from "./routes/agent.js";
import { agentProxyRouter } from "./routes/agent-proxy.js";
import { filesRouter } from "./routes/files.js";
import { githubRouter } from "./routes/github.js";
import { projectsRouter } from "./routes/projects.js";
import { attachUser } from "./lib/auth.js";
import { assertEnv, isProd } from "./lib/env.js";
import { db } from "./lib/db.js";
import { csrfGuard } from "./lib/csrf.js";
import { startIdleReaper } from "./lib/docker.js";

dotenv.config();
assertEnv();

const app = express();
const PORT = process.env.PORT || 3001;

if (isProd()) {
  // honor X-Forwarded-* from reverse proxy (nginx, traefik) for secure cookie + ip-based rate-limit
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    // SPA on a different origin — relax CSP, otherwise dev breaks; tune at deploy if needed
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / curl
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("CORS: origin not allowed"));
    },
    credentials: true,
  })
);

// ── Agent billing proxy ──────────────────────────────────────────────────────
// MUST be mounted BEFORE the global json parser: the Claude Code CLI sends large
// Messages-API payloads (>256kb), and the proxy has its own express.json(20mb).
// Auth is via x-api-key (workspace token), NOT cookies — so it is also exempt
// from cookie/CSRF middleware below. Container calls cannot carry the
// X-Requested-With CSRF header; the bcrypt-hashed workspace token is the guard.
app.use("/api/agent-proxy", agentProxyRouter);

app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());
app.use(attachUser);
app.use(csrfGuard);

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/workspace", workspaceRouter);
app.use("/api/agent", agentRouter);
app.use("/api/files", filesRouter);
app.use("/api/github", githubRouter);
app.use("/api/projects", projectsRouter);
app.use("/api", chatRouter);
app.use("/api/chats/:chatId/attachments", attachmentsRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Serve built SPA in production (single-container deploy).
if (isProd()) {
  const clientDir = path.resolve(process.cwd(), "client/dist");
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir, { maxAge: "1h", index: false }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(clientDir, "index.html"));
    });
  } else {
    console.warn(`[static] client/dist not found at ${clientDir} — SPA will not be served`);
  }
}

// Periodic cleanup of expired sessions to keep the table bounded.
setInterval(() => {
  try {
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(Date.now());
  } catch (e) {
    console.error("[sessions cleanup]", e);
  }
}, 60 * 60_000).unref();

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Attach the agent WebSocket server (/api/agent/ws) to the same HTTP server.
attachAgentWss(server);

// Stop idle workspace containers (no-op when docker is unavailable).
try {
  startIdleReaper();
} catch (e) {
  console.warn("[idle-reaper] not started:", (e as Error).message);
}
