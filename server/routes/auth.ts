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
import { loginLimiter, registerLimiter, redeemLimiter } from "../lib/rateLimit.js";

export const authRouter = Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

authRouter.post("/register", registerLimiter, (req, res) => {
  const { username, password, inviteCode } = req.body ?? {};
  if (!username || !password || !inviteCode) {
    return res.status(400).json({ error: "username, password, inviteCode required" });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: "username must be 3-32 chars [a-zA-Z0-9_]" });
  }
  if (typeof password !== "string" || password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: "password must be 6-128 chars" });
  }

  if (getUserByUsername(username)) {
    return res.status(409).json({ error: "username taken" });
  }

  // Atomic invite consumption + user creation: single transaction with conditional UPDATE
  // prevents the SELECT/UPDATE race that lets two registrations share one invite.
  let user;
  try {
    const tx = db.transaction(() => {
      const claim = db
        .prepare(
          `UPDATE invite_codes SET used_by = ?, used_at = ?
           WHERE code = ? AND used_by IS NULL`
        )
        .run("__pending__", Date.now(), inviteCode);
      if (claim.changes === 0) throw new Error("invalid_or_used_invite");
      const u = createUser({ username, password });
      db.prepare(`UPDATE invite_codes SET used_by = ? WHERE code = ?`).run(u.id, inviteCode);
      return u;
    });
    user = tx();
  } catch (e: any) {
    if (e?.message === "invalid_or_used_invite") {
      return res.status(400).json({ error: "invalid or already used invite code" });
    }
    throw e;
  }

  const sid = createSession(user.id);
  setSessionCookie(res, sid);
  res.json({ user: publicUser(user) });
});

authRouter.post("/login", loginLimiter, (req, res) => {
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

authRouter.post("/redeem", redeemLimiter, requireAuth, (req, res) => {
  const { code } = req.body ?? {};
  if (!code || typeof code !== "string" || code.length > 64) {
    return res.status(400).json({ error: "code required" });
  }

  let added = 0;
  try {
    const tx = db.transaction(() => {
      // Atomic claim — UPDATE only if not used; capture amount via subsequent SELECT in same tx.
      const claim = db
        .prepare(
          `UPDATE token_codes SET used_by = ?, used_at = ?
           WHERE code = ? AND used_by IS NULL`
        )
        .run(req.user!.id, Date.now(), code);
      if (claim.changes === 0) throw new Error("invalid_or_used_code");
      const tc = db.prepare(`SELECT amount FROM token_codes WHERE code = ?`).get(code) as any;
      added = tc.amount;
      db.prepare(
        `UPDATE users SET token_balance = token_balance + ? WHERE id = ?`
      ).run(added, req.user!.id);
    });
    tx();
  } catch (e: any) {
    if (e?.message === "invalid_or_used_code") {
      return res.status(400).json({ error: "invalid or already used code" });
    }
    throw e;
  }

  const balance = (db.prepare(`SELECT token_balance FROM users WHERE id = ?`).get(req.user!.id) as any)
    .token_balance as number;
  res.json({ ok: true, added, balance });
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
