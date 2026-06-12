// Agent session CRUD + the Claude Code CLI runner (ADR-004).
//
// runAgent() spawns `claude -p <prompt> --output-format stream-json --verbose`
// inside the user's workspace container (via lib/docker.execInWorkspace), parses
// the NDJSON event stream, persists each event to agent_events, and emits typed
// AgentServerMessage objects to the caller (the WS layer).
//
// Billing is NOT done here — the CLI's traffic is billed by routes/agent-proxy.ts.
// The `result` message reports the user's *current* DB balance (already settled by
// the proxy) plus the CLI-reported token usage for display.

import { nanoid } from "nanoid";
import { db, AgentSession, AgentSessionStatus, AgentEventRow, User } from "./db.js";
import type { AgentServerMessage } from "./agentTypes.js";
import {
  ensureWorkspace,
  execInWorkspace,
  touchActivity,
  getWorkspaceState,
  getDiskUsage,
  DockerUnavailableError,
} from "./docker.js";

// ── Session CRUD (all scoped by user_id — IDOR-safe) ─────────────────────────

export function createSession(userId: string, title?: string): AgentSession {
  const id = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO agent_sessions (id, user_id, title, cli_session_id, status, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'idle', ?, ?)`
  ).run(id, userId, title?.trim() || "New session", now, now);
  return getSessionRaw(id)!;
}

export function listSessions(userId: string): AgentSession[] {
  return db
    .prepare(`SELECT * FROM agent_sessions WHERE user_id = ? ORDER BY updated_at DESC`)
    .all(userId) as AgentSession[];
}

// Owner-scoped fetch. Callers MUST pass the requesting user's id to avoid IDOR.
export function getSession(userId: string, id: string): AgentSession | undefined {
  return db
    .prepare(`SELECT * FROM agent_sessions WHERE id = ? AND user_id = ?`)
    .get(id, userId) as AgentSession | undefined;
}

// Internal unscoped fetch (only used right after we created/verified ownership).
function getSessionRaw(id: string): AgentSession | undefined {
  return db.prepare(`SELECT * FROM agent_sessions WHERE id = ?`).get(id) as AgentSession | undefined;
}

export function deleteSession(userId: string, id: string): boolean {
  const res = db.prepare(`DELETE FROM agent_sessions WHERE id = ? AND user_id = ?`).run(id, userId);
  return res.changes > 0;
}

export function setSessionStatus(id: string, status: AgentSessionStatus): void {
  db.prepare(`UPDATE agent_sessions SET status = ?, updated_at = ? WHERE id = ?`).run(status, Date.now(), id);
}

export function setCliSessionId(id: string, cli: string): void {
  db.prepare(`UPDATE agent_sessions SET cli_session_id = ?, updated_at = ? WHERE id = ?`).run(cli, Date.now(), id);
}

export function appendEvent(sessionId: string, type: string, payload: unknown): void {
  db.prepare(
    `INSERT INTO agent_events (session_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)`
  ).run(sessionId, type, payload === undefined ? null : JSON.stringify(payload), Date.now());
}

export function listEvents(sessionId: string): AgentEventRow[] {
  return db
    .prepare(`SELECT * FROM agent_events WHERE session_id = ? ORDER BY id ASC`)
    .all(sessionId) as AgentEventRow[];
}

// ── CLI NDJSON → AgentServerMessage translation ──────────────────────────────

function currentBalance(userId: string): number {
  const row = db.prepare(`SELECT token_balance FROM users WHERE id = ?`).get(userId) as
    | { token_balance: number }
    | undefined;
  return row?.token_balance ?? 0;
}

export interface RunHandle {
  cancel: () => void;
  done: Promise<void>;
}

export function runAgent(opts: {
  user: User;
  session: AgentSession;
  prompt: string;
  model?: string;
  onEvent: (msg: AgentServerMessage) => void;
}): RunHandle {
  const { user, session, prompt, model, onEvent } = opts;

  let cancelled = false;
  let execStream: NodeJS.ReadWriteStream | null = null;

  const emit = (msg: AgentServerMessage, persist = true) => {
    onEvent(msg);
    if (persist) {
      try {
        appendEvent(session.id, msg.type, msg);
      } catch (e) {
        console.error("[agent] appendEvent failed:", e);
      }
    }
  };

  const cancel = () => {
    cancelled = true;
    try {
      (execStream as unknown as { destroy?: () => void })?.destroy?.();
    } catch {}
    // Best-effort: kill any claude process inside the container.
    execInWorkspace(user.id, ["pkill", "-f", "claude"]).catch(() => {});
  };

  const done = (async () => {
    emit({ type: "status", status: "starting" });
    setSessionStatus(session.id, "running");

    // --- Workspace + pre-flight checks ------------------------------------
    try {
      await ensureWorkspace(user);
      touchActivity(user.id);
    } catch (e: any) {
      console.error("[agent] ensureWorkspace failed:", e?.message || e);
      setSessionStatus(session.id, "error");
      if (e instanceof DockerUnavailableError) {
        emit({ type: "error", message: "workspace runtime unavailable", code: 503 });
      } else {
        emit({ type: "error", message: "failed to start workspace", code: 500 });
      }
      return;
    }

    if (user.token_balance <= 0 && currentBalance(user.id) <= 0) {
      setSessionStatus(session.id, "error");
      emit({ type: "error", message: "insufficient balance", code: 402 });
      return;
    }

    // Disk quota pre-check (soft quota, ADR-003).
    try {
      const state = getWorkspaceState(user.id);
      const quota = state?.disk_quota_bytes ?? null;
      if (quota != null) {
        const used = (await getDiskUsage(user.id).catch(() => state?.disk_used_bytes ?? 0)) ?? 0;
        if (used >= quota) {
          setSessionStatus(session.id, "error");
          emit({
            type: "error",
            message: `disk quota exceeded (${used} / ${quota} bytes)`,
            code: 507,
          });
          return;
        }
      }
    } catch (e) {
      // Quota check is best-effort; don't block the run on a check failure.
      console.error("[agent] quota check failed:", e);
    }

    if (cancelled) {
      setSessionStatus(session.id, "idle");
      return;
    }

    // --- Build the claude CLI command -------------------------------------
    const cmd = [
      "claude",
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];
    if (model) cmd.push("--model", model);
    if (session.cli_session_id) cmd.push("--resume", session.cli_session_id);

    emit({ type: "status", status: "running" });

    // --- Exec + NDJSON parse ----------------------------------------------
    // tty:true gives a clean, un-multiplexed stdout (what the NDJSON reader
    // wants). The container's WorkingDir is already /workspace.
    try {
      const r = await execInWorkspace(user.id, cmd, { tty: true });
      execStream = r.stream;
    } catch (e: any) {
      console.error("[agent] execInWorkspace failed:", e?.message || e);
      setSessionStatus(session.id, "error");
      if (e instanceof DockerUnavailableError) {
        emit({ type: "error", message: "workspace runtime unavailable", code: 503 });
      } else {
        emit({ type: "error", message: "failed to launch agent", code: 500 });
      }
      return;
    }

    let buf = "";
    let sawResult = false;
    const nonJsonLines: string[] = []; // captured for diagnostics if no result

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let evt: any;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        // Not a JSON line — likely CLI stderr/diagnostic (tty merges streams).
        if (nonJsonLines.length < 50) nonJsonLines.push(trimmed);
        return; // forward-compatible: ignore for event translation
      }
      translateCliEvent(evt);
    };

    const translateCliEvent = (evt: any) => {
      switch (evt?.type) {
        case "system":
          // init / system events — ignore (status already emitted).
          break;
        case "assistant": {
          const blocks = evt.message?.content;
          if (Array.isArray(blocks)) {
            for (const b of blocks) {
              if (b?.type === "text" && typeof b.text === "string" && b.text.length) {
                emit({ type: "assistant_text", text: b.text });
              } else if (b?.type === "tool_use") {
                emit({ type: "tool_use", id: String(b.id ?? ""), name: String(b.name ?? ""), input: b.input });
              }
            }
          }
          break;
        }
        case "user": {
          const blocks = evt.message?.content;
          if (Array.isArray(blocks)) {
            for (const b of blocks) {
              if (b?.type === "tool_result") {
                const content =
                  typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
                emit({
                  type: "tool_result",
                  id: String(b.tool_use_id ?? ""),
                  content,
                  isError: b.is_error === true,
                });
              }
            }
          }
          break;
        }
        case "result": {
          sawResult = true;
          if (typeof evt.session_id === "string" && evt.session_id) {
            try {
              setCliSessionId(session.id, evt.session_id);
            } catch (e) {
              console.error("[agent] setCliSessionId failed:", e);
            }
          }
          const u = evt.usage ?? {};
          const inputTokens =
            (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          const outputTokens = u.output_tokens ?? 0;
          // Billing already settled by the proxy; report current DB balance.
          const balance = currentBalance(user.id);
          // Best-effort cost in our units from the CLI-reported usage (display only).
          const costUnits = typeof evt.total_cost_usd === "number" ? evt.total_cost_usd : 0;
          emit({
            type: "result",
            subtype: typeof evt.subtype === "string" ? evt.subtype : undefined,
            costUnits,
            balance,
            inputTokens,
            outputTokens,
            durationMs: typeof evt.duration_ms === "number" ? evt.duration_ms : undefined,
          });
          break;
        }
        default:
          // Unknown event type — ignore (forward-compatible).
          break;
      }
    };

    // With tty:true the exec stream is a single clean stdout (stderr is merged
    // in). Read it line-by-line as NDJSON; non-JSON lines are ignored.
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      execStream!.on("data", (chunk: Buffer | string) => {
        buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          handleLine(line);
        }
      });
      execStream!.on("end", finish);
      execStream!.on("close", finish);
      execStream!.on("error", (e: any) => {
        console.error("[agent] exec stream error:", e?.message || e);
        finish();
      });
    });

    // Flush any trailing buffered line.
    if (buf.trim()) handleLine(buf);

    if (cancelled) {
      setSessionStatus(session.id, "idle");
      emit({ type: "status", status: "idle", detail: "cancelled" });
      return;
    }

    if (!sawResult) {
      const diag = nonJsonLines.join("\n").slice(-500);
      setSessionStatus(session.id, "error");
      emit({ type: "error", message: diag || "agent ended without a result", code: 500 });
      return;
    }

    setSessionStatus(session.id, "idle");
    emit({ type: "status", status: "idle" }, false);
  })().catch((e) => {
    console.error("[agent] run crashed:", e);
    try {
      setSessionStatus(session.id, "error");
    } catch {}
    onEvent({ type: "error", message: "internal agent error", code: 500 });
  });

  return { cancel, done };
}
