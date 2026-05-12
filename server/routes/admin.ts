import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../lib/db.js";
import { requireAdmin } from "../lib/auth.js";

export const adminRouter = Router();

adminRouter.use(requireAdmin);

function genCode(prefix: string) {
  // Human-readable: PREFIX-XXXX-XXXX
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${prefix}-${part(4)}-${part(4)}`;
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
  const updated = db.prepare(`SELECT id, username, role, status, token_balance FROM users WHERE id = ?`).get(id);
  res.json({ user: updated });
});

adminRouter.delete("/users/:id", (req, res) => {
  if (req.params.id === req.user!.id) return res.status(400).json({ error: "cannot delete self" });
  db.prepare(`DELETE FROM users WHERE id = ?`).run(req.params.id);
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
  res.json({ code });
});

adminRouter.delete("/invites/:code", (req, res) => {
  const r = db
    .prepare(`DELETE FROM invite_codes WHERE code = ? AND used_by IS NULL`)
    .run(req.params.code);
  if (r.changes === 0) return res.status(400).json({ error: "not found or already used" });
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
  res.json({ code, amount });
});

adminRouter.delete("/token-codes/:code", (req, res) => {
  const r = db
    .prepare(`DELETE FROM token_codes WHERE code = ? AND used_by IS NULL`)
    .run(req.params.code);
  if (r.changes === 0) return res.status(400).json({ error: "not found or already used" });
  res.json({ ok: true });
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
