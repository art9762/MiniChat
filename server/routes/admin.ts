import { Router } from "express";
import { randomInt } from "crypto";
import { db } from "../lib/db.js";
import { requireAdmin } from "../lib/auth.js";
import {
  stopWorkspace,
  removeWorkspace,
  DockerUnavailableError,
} from "../lib/docker.js";

export const adminRouter = Router();

adminRouter.use(requireAdmin);

function genCode(prefix: string) {
  // Human-readable: PREFIX-XXXX-XXXX. CSPRNG (crypto.randomInt) — not Math.random.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (n: number) =>
    Array.from({ length: n }, () => chars[randomInt(0, chars.length)]).join("");
  return `${prefix}-${part(4)}-${part(4)}`;
}

function countActiveAdmins(): number {
  return (db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active'`)
    .get() as { n: number }).n;
}

function audit(adminId: string, action: string, targetId: string | null, payload: any) {
  try {
    db.prepare(
      `INSERT INTO admin_audit_log (admin_id, action, target_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(adminId, action, targetId, payload == null ? null : JSON.stringify(payload), Date.now());
  } catch (e) {
    console.error("[audit]", e);
  }
}

// USERS
adminRouter.get("/users", (_req, res) => {
  const users = db
    .prepare(
      `SELECT id, username, role, status, token_balance, created_at,
              (SELECT COUNT(*) FROM usage_log WHERE user_id = users.id) AS requests,
              (SELECT COALESCE(SUM(cost), 0) FROM usage_log WHERE user_id = users.id) AS spent
       FROM users ORDER BY created_at DESC`
    )
    .all();
  res.json({ users });
});

adminRouter.patch("/users/:id", (req, res) => {
  const { id } = req.params;
  const { status, role, token_balance, addTokens } = req.body ?? {};

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as any;
  if (!user) return res.status(404).json({ error: "not found" });

  // Guard: prevent removing the last active admin (demote, suspend, ban).
  const wouldRemoveAdmin =
    user.role === "admin" &&
    user.status === "active" &&
    ((role && role !== "admin") || (status && status !== "active"));
  if (wouldRemoveAdmin && countActiveAdmins() <= 1) {
    return res.status(400).json({ error: "cannot demote/suspend the last active admin" });
  }

  const updates: string[] = [];
  const values: any[] = [];
  if (status && ["active", "suspended", "banned"].includes(status)) {
    updates.push("status = ?");
    values.push(status);
  }
  if (role && ["user", "admin"].includes(role)) {
    updates.push("role = ?");
    values.push(role);
  }
  if (typeof token_balance === "number") {
    updates.push("token_balance = ?");
    values.push(Math.max(0, Math.floor(token_balance)));
  } else if (typeof addTokens === "number") {
    updates.push("token_balance = token_balance + ?");
    values.push(Math.floor(addTokens));
  }
  if (updates.length === 0) return res.status(400).json({ error: "nothing to update" });
  values.push(id);
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  audit(req.user!.id, "user.update", id, { status, role, token_balance, addTokens });
  const updated = db.prepare(`SELECT id, username, role, status, token_balance FROM users WHERE id = ?`).get(id);
  res.json({ user: updated });
});

adminRouter.delete("/users/:id", (req, res) => {
  if (req.params.id === req.user!.id) return res.status(400).json({ error: "cannot delete self" });
  const target = db.prepare(`SELECT role, status FROM users WHERE id = ?`).get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: "not found" });
  if (target.role === "admin" && target.status === "active" && countActiveAdmins() <= 1) {
    return res.status(400).json({ error: "cannot delete the last active admin" });
  }
  db.prepare(`DELETE FROM users WHERE id = ?`).run(req.params.id);
  audit(req.user!.id, "user.delete", req.params.id, null);
  res.json({ ok: true });
});

// INVITES
adminRouter.get("/invites", (_req, res) => {
  const invites = db
    .prepare(
      `SELECT i.*, u.username AS used_by_username
       FROM invite_codes i
       LEFT JOIN users u ON u.id = i.used_by
       ORDER BY i.created_at DESC`
    )
    .all();
  res.json({ invites });
});

adminRouter.post("/invites", (req, res) => {
  const code = genCode("INV");
  db.prepare(
    `INSERT INTO invite_codes (code, created_by, created_at) VALUES (?, ?, ?)`
  ).run(code, req.user!.id, Date.now());
  audit(req.user!.id, "invite.create", null, { code });
  res.json({ code });
});

adminRouter.delete("/invites/:code", (req, res) => {
  const r = db
    .prepare(`DELETE FROM invite_codes WHERE code = ? AND used_by IS NULL`)
    .run(req.params.code);
  if (r.changes === 0) return res.status(400).json({ error: "not found or already used" });
  audit(req.user!.id, "invite.delete", null, { code: req.params.code });
  res.json({ ok: true });
});

// TOKEN CODES
adminRouter.get("/token-codes", (_req, res) => {
  const codes = db
    .prepare(
      `SELECT t.*, u.username AS used_by_username
       FROM token_codes t
       LEFT JOIN users u ON u.id = t.used_by
       ORDER BY t.created_at DESC`
    )
    .all();
  res.json({ codes });
});

adminRouter.post("/token-codes", (req, res) => {
  const amount = Math.floor(Number(req.body?.amount));
  if (!amount || amount <= 0) return res.status(400).json({ error: "amount must be positive" });
  const code = genCode("TKN");
  db.prepare(
    `INSERT INTO token_codes (code, amount, created_by, created_at) VALUES (?, ?, ?, ?)`
  ).run(code, amount, req.user!.id, Date.now());
  audit(req.user!.id, "token_code.create", null, { code, amount });
  res.json({ code, amount });
});

adminRouter.delete("/token-codes/:code", (req, res) => {
  const r = db
    .prepare(`DELETE FROM token_codes WHERE code = ? AND used_by IS NULL`)
    .run(req.params.code);
  if (r.changes === 0) return res.status(400).json({ error: "not found or already used" });
  audit(req.user!.id, "token_code.delete", null, { code: req.params.code });
  res.json({ ok: true });
});

// AUDIT LOG
adminRouter.get("/audit", (_req, res) => {
  const entries = db
    .prepare(
      `SELECT a.*, u.username AS admin_username
       FROM admin_audit_log a
       LEFT JOIN users u ON u.id = a.admin_id
       ORDER BY a.created_at DESC
       LIMIT 500`
    )
    .all();
  res.json({ entries });
});

// ── WORKSPACES ──────────────────────────────────────────────────────────────
// Read straight from the workspaces table (left-joined with users). We never
// require docker here — the table reflects the last-known state, so the list
// renders even when the docker daemon is down.
adminRouter.get("/workspaces", (_req, res) => {
  const workspaces = db
    .prepare(
      `SELECT w.user_id, u.username, w.status, w.disk_used_bytes, w.disk_quota_bytes,
              w.last_activity_at, w.container_id
       FROM workspaces w
       LEFT JOIN users u ON u.id = w.user_id
       ORDER BY w.last_activity_at DESC NULLS LAST, w.created_at DESC`
    )
    .all();
  res.json({ workspaces });
});

// PATCH /workspaces/:userId { quotaBytes? | quotaGB? } — set the disk quota.
// NULL (either field passed as null) means unlimited. quotaGB is converted to
// bytes (GiB * 1024^3). Creates the workspace row on demand so a quota can be
// pre-set before the user ever starts a container.
adminRouter.patch("/workspaces/:userId", (req, res) => {
  const { userId } = req.params;
  const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(userId) as any;
  if (!user) return res.status(404).json({ error: "user not found" });

  const { quotaBytes, quotaGB } = req.body ?? {};
  let quota: number | null;
  if (quotaBytes === null || quotaGB === null) {
    quota = null; // unlimited
  } else if (typeof quotaBytes === "number" && isFinite(quotaBytes) && quotaBytes >= 0) {
    quota = Math.floor(quotaBytes);
  } else if (typeof quotaGB === "number" && isFinite(quotaGB) && quotaGB >= 0) {
    quota = Math.floor(quotaGB * 1024 * 1024 * 1024);
  } else {
    return res.status(400).json({ error: "provide quotaBytes or quotaGB (number, or null for unlimited)" });
  }

  // Ensure a row exists, then set the quota.
  const exists = db.prepare(`SELECT user_id FROM workspaces WHERE user_id = ?`).get(userId);
  if (exists) {
    db.prepare(`UPDATE workspaces SET disk_quota_bytes = ? WHERE user_id = ?`).run(quota, userId);
  } else {
    db.prepare(
      `INSERT INTO workspaces (user_id, volume_name, status, disk_used_bytes, disk_quota_bytes, created_at)
       VALUES (?, ?, 'none', 0, ?, ?)`
    ).run(userId, `mc-ws-${userId}`, quota, Date.now());
  }
  audit(req.user!.id, "workspace.quota", userId, { quota });
  const updated = db
    .prepare(`SELECT user_id, status, disk_used_bytes, disk_quota_bytes FROM workspaces WHERE user_id = ?`)
    .get(userId);
  res.json({ workspace: updated });
});

// POST /workspaces/:userId/stop — stop the user's container (files persist).
adminRouter.post("/workspaces/:userId/stop", async (req, res) => {
  const { userId } = req.params;
  const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(userId) as any;
  if (!user) return res.status(404).json({ error: "user not found" });
  try {
    await stopWorkspace(userId);
    audit(req.user!.id, "workspace.stop", userId, null);
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof DockerUnavailableError) {
      return res.status(503).json({ error: "docker unavailable" });
    }
    console.error("[admin] workspace stop failed:", e);
    res.status(500).json({ error: "failed to stop workspace" });
  }
});

// POST /workspaces/:userId/delete { wipeVolume? } — remove the container and,
// when wipeVolume is true, the persistent volume (destroys the user's files).
adminRouter.post("/workspaces/:userId/delete", async (req, res) => {
  const { userId } = req.params;
  const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(userId) as any;
  if (!user) return res.status(404).json({ error: "user not found" });
  const wipeVolume = req.body?.wipeVolume === true;
  try {
    await removeWorkspace(userId, { wipeVolume });
    audit(req.user!.id, "workspace.delete", userId, { wipeVolume });
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof DockerUnavailableError) {
      return res.status(503).json({ error: "docker unavailable" });
    }
    console.error("[admin] workspace delete failed:", e);
    res.status(500).json({ error: "failed to delete workspace" });
  }
});

// ── AGENT RUNS ──────────────────────────────────────────────────────────────
// Per-user agent activity. NOTE: usage_log does not distinguish agent (CLI via
// agent-proxy) vs plain chat traffic — both write the same rows. We therefore
// APPROXIMATE: `sessions` is the exact count of agent_sessions per user, while
// `runs`/`tokens`/`cost` are that user's TOTAL usage_log aggregates (chat +
// agent). Only users who have at least one agent session are returned. If the
// agent and chat paths ever need to be separated, tag usage_log rows by source.
adminRouter.get("/agent-runs", (_req, res) => {
  const runs = db
    .prepare(
      `SELECT s.user_id,
              u.username,
              COUNT(DISTINCT s.id) AS sessions,
              COALESCE(ul.runs, 0)   AS runs,
              COALESCE(ul.tokens, 0) AS tokens,
              COALESCE(ul.cost, 0)   AS cost
       FROM agent_sessions s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN (
         SELECT user_id,
                COUNT(*) AS runs,
                SUM(input_tokens + output_tokens) AS tokens,
                SUM(cost) AS cost
         FROM usage_log
         GROUP BY user_id
       ) ul ON ul.user_id = s.user_id
       GROUP BY s.user_id
       ORDER BY cost DESC`
    )
    .all();
  res.json({ runs });
});

// STATS
adminRouter.get("/stats", (_req, res) => {
  const totals = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM users WHERE status='active') AS active,
         (SELECT COUNT(*) FROM users WHERE status='suspended') AS suspended,
         (SELECT COUNT(*) FROM users WHERE status='banned') AS banned,
         (SELECT COUNT(*) FROM invite_codes WHERE used_by IS NULL) AS invites_open,
         (SELECT COUNT(*) FROM token_codes WHERE used_by IS NULL) AS token_codes_open,
         (SELECT COALESCE(SUM(cost),0) FROM usage_log) AS total_spent,
         (SELECT COUNT(*) FROM usage_log) AS total_requests`
    )
    .get();
  res.json(totals);
});
