import { Router } from "express";
import { db } from "../lib/db.js";
import {
  createSession,
  createUser,
  destroySession,
  getUserByUsername,
  setSessionCookie,
  clearSessionCookie,
  verifyPassword,
  requireAuth,
  COOKIE_NAME,
} from "../lib/auth.js";

export const authRouter = Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

authRouter.post("/register", (req, res) => {
  const { username, password, inviteCode } = req.body ?? {};
  if (!username || !password || !inviteCode) {
    return res.status(400).json({ error: "username, password, inviteCode required" });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: "username must be 3-32 chars [a-zA-Z0-9_]" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "password must be at least 6 chars" });
  }

  const invite = db
    .prepare(`SELECT * FROM invite_codes WHERE code = ?`)
    .get(inviteCode) as any;
  if (!invite) return res.status(400).json({ error: "invalid invite code" });
  if (invite.used_by) return res.status(400).json({ error: "invite code already used" });

  if (getUserByUsername(username)) {
    return res.status(409).json({ error: "username taken" });
  }

  const tx = db.transaction(() => {
    const user = createUser({ username, password });
    db.prepare(
      `UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ?`
    ).run(user.id, Date.now(), inviteCode);
    return user;
  });
  const user = tx();

  const sid = createSession(user.id);
  setSessionCookie(res, sid);
  res.json({ user: publicUser(user) });
});

authRouter.post("/login", (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: "username, password required" });
  const user = getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "invalid credentials" });
  }
  if (user.status === "banned") return res.status(403).json({ error: "banned" });
  const sid = createSession(user.id);
  setSessionCookie(res, sid);
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", (req, res) => {
  const sid = req.cookies?.[COOKIE_NAME];
  if (sid) destroySession(sid);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

authRouter.post("/redeem", requireAuth, (req, res) => {
  const { code } = req.body ?? {};
  if (!code) return res.status(400).json({ error: "code required" });
  const tc = db.prepare(`SELECT * FROM token_codes WHERE code = ?`).get(code) as any;
  if (!tc) return res.status(400).json({ error: "invalid code" });
  if (tc.used_by) return res.status(400).json({ error: "code already used" });

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE token_codes SET used_by = ?, used_at = ? WHERE code = ?`
    ).run(req.user!.id, Date.now(), code);
    db.prepare(
      `UPDATE users SET token_balance = token_balance + ? WHERE id = ?`
    ).run(tc.amount, req.user!.id);
  });
  tx();

  const balance = (db.prepare(`SELECT token_balance FROM users WHERE id = ?`).get(req.user!.id) as any)
    .token_balance as number;
  res.json({ ok: true, added: tc.amount, balance });
});

function publicUser(u: any) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    status: u.status,
    token_balance: u.token_balance,
    created_at: u.created_at,
  };
}
