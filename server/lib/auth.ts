import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import type { Request, Response, NextFunction } from "express";
import { db, User } from "./db.js";
import { cookieSecure } from "./env.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d
const COOKIE_NAME = "mc_sid";

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}
export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function createUser(opts: {
  username: string;
  password: string;
  role?: "user" | "admin";
  initialBalance?: number;
}): User {
  const id = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, status, token_balance, created_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ).run(
    id,
    opts.username,
    hashPassword(opts.password),
    opts.role ?? "user",
    opts.initialBalance ?? 0,
    now
  );
  return getUserById(id)!;
}

export function getUserByUsername(username: string): User | undefined {
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as User | undefined;
}
export function getUserById(id: string): User | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as User | undefined;
}

export function createSession(userId: string): string {
  const sid = nanoid(32);
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
  ).run(sid, userId, now, now + SESSION_TTL_MS);
  return sid;
}

export function destroySession(sid: string) {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sid);
}

export function getUserBySession(sid: string): User | undefined {
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`
    )
    .get(sid, Date.now()) as User | undefined;
  return row;
}

export function setSessionCookie(res: Response, sid: string) {
  res.cookie(COOKIE_NAME, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}
export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const sid = req.cookies?.[COOKIE_NAME];
  if (sid) {
    const user = getUserBySession(sid);
    if (user) req.user = user;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "unauthorized" });
  if (req.user.status === "banned") return res.status(403).json({ error: "banned" });
  if (req.user.status === "suspended") return res.status(403).json({ error: "suspended" });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "unauthorized" });
  if (req.user.role !== "admin") return res.status(403).json({ error: "forbidden" });
  next();
}

export { COOKIE_NAME };
