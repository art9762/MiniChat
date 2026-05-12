import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

export const projectsRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function getMember(projectId: string, userId: string) {
  return db
    .prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`)
    .get(projectId, userId) as { role: string } | undefined;
}

function requireProjectMember(projectId: string, userId: string) {
  const m = getMember(projectId, userId);
  if (!m) throw Object.assign(new Error("not a member"), { status: 403 });
  return m;
}

function requireProjectOwner(projectId: string, userId: string) {
  const m = requireProjectMember(projectId, userId);
  if (m.role !== "owner") throw Object.assign(new Error("owner only"), { status: 403 });
}

function sendErr(res: any, err: any) {
  const status = err?.status ?? 500;
  res.status(status).json({ error: err?.message ?? "internal error" });
}

// ── GET /projects — list mine ─────────────────────────────────────────────────
projectsRouter.get("/", requireAuth, (req, res) => {
  const user = (req as any).user;
  const rows = db
    .prepare(
      `SELECT p.*, pm.role
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = ?
       ORDER BY p.updated_at DESC`
    )
    .all(user.id);
  res.json(rows);
});

// ── POST /projects — create ───────────────────────────────────────────────────
projectsRouter.post("/", requireAuth, (req, res) => {
  const user = (req as any).user;
  const { name, description, master_prompt } = req.body ?? {};
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: "name is required" });
  }
  if (name.length > 120) return res.status(400).json({ error: "name too long" });

  const id = nanoid();
  const now = Date.now();

  const project = db.transaction(() => {
    db.prepare(
      `INSERT INTO projects (id, owner_id, name, description, master_prompt, memory, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(id, user.id, name.trim(), description ?? null, master_prompt ?? null, now, now);

    db.prepare(
      `INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)`
    ).run(id, user.id, now);

    return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
  })();

  res.status(201).json(project);
});

// ── GET /projects/:id — details ───────────────────────────────────────────────
projectsRouter.get("/:id", requireAuth, (req, res) => {
  const user = (req as any).user;
  try {
    requireProjectMember(req.params["id"] as string, user.id);
  } catch (e) {
    return sendErr(res, e);
  }

  const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(req.params["id"] as string);
  if (!project) return res.status(404).json({ error: "not found" });

  const members = db
    .prepare(
      `SELECT pm.user_id, pm.role, pm.added_at, u.username
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ?`
    )
    .all(req.params["id"] as string);

  const files = db
    .prepare(
      `SELECT id, name, mime_type, size_bytes, uploaded_by, uploaded_at
       FROM project_files WHERE project_id = ? ORDER BY uploaded_at DESC`
    )
    .all(req.params["id"] as string);

  res.json({ ...(project as any), members, files });
});

// ── PATCH /projects/:id — update ─────────────────────────────────────────────
projectsRouter.patch("/:id", requireAuth, (req, res) => {
  const user = (req as any).user;
  let member: { role: string };
  try {
    member = requireProjectMember(req.params["id"] as string, user.id);
  } catch (e) {
    return sendErr(res, e);
  }

  const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(req.params["id"] as string) as any;
  if (!project) return res.status(404).json({ error: "not found" });

  const { name, description, master_prompt, memory } = req.body ?? {};

  // Only owner can rename
  if (name !== undefined && member.role !== "owner") {
    return res.status(403).json({ error: "only owner can rename" });
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) return res.status(400).json({ error: "invalid name" });
    updates.push("name = ?"); params.push(name.trim());
  }
  if (description !== undefined) { updates.push("description = ?"); params.push(description); }
  if (master_prompt !== undefined) { updates.push("master_prompt = ?"); params.push(master_prompt); }
  if (memory !== undefined) { updates.push("memory = ?"); params.push(memory); }

  if (updates.length === 0) return res.status(400).json({ error: "nothing to update" });

  updates.push("updated_at = ?"); params.push(Date.now());
  params.push(req.params["id"] as string);

  db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  const updated = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(req.params["id"] as string);
  res.json(updated);
});

// ── DELETE /projects/:id ──────────────────────────────────────────────────────
projectsRouter.delete("/:id", requireAuth, (req, res) => {
  const user = (req as any).user;
  try {
    requireProjectOwner(req.params["id"] as string, user.id);
  } catch (e) {
    return sendErr(res, e);
  }

  const result = db.prepare(`DELETE FROM projects WHERE id = ?`).run(req.params["id"] as string);
  if (result.changes === 0) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

// ── POST /projects/:id/invites — create invite link ───────────────────────────
projectsRouter.post("/:id/invites", requireAuth, (req, res) => {
  const user = (req as any).user;
  try {
    requireProjectOwner(req.params["id"] as string, user.id);
  } catch (e) {
    return sendErr(res, e);
  }

  const project = db.prepare(`SELECT id FROM projects WHERE id = ?`).get(req.params["id"] as string);
  if (!project) return res.status(404).json({ error: "not found" });

  const { maxUses, expiresInHours } = req.body ?? {};
  const max_uses = typeof maxUses === "number" && maxUses > 0 ? maxUses : 1;
  const expires_at =
    typeof expiresInHours === "number" && expiresInHours > 0
      ? Date.now() + expiresInHours * 3_600_000
      : null;

  const token = nanoid(32);
  const now = Date.now();

  db.prepare(
    `INSERT INTO project_invites (token, project_id, created_by, max_uses, used_count, expires_at, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).run(token, req.params["id"] as string, user.id, max_uses, expires_at, now);

  const url = `${process.env.CLIENT_ORIGIN || "http://localhost:5173"}/projects/join/${token}`;
  res.status(201).json({ token, url });
});

// ── POST /projects/join/:token ─────────────────────────────────────────────────
projectsRouter.post("/join/:token", requireAuth, (req, res) => {
  const user = (req as any).user;
  const token = req.params["token"] as string;

  let projectId: string;
  try {
    const tx = db.transaction(() => {
      const invite = db
        .prepare(`SELECT * FROM project_invites WHERE token = ?`)
        .get(token) as any;

      if (!invite) throw Object.assign(new Error("invalid invite"), { status: 404 });
      if (invite.expires_at !== null && invite.expires_at < Date.now())
        throw Object.assign(new Error("invite expired"), { status: 410 });
      if (invite.used_count >= invite.max_uses)
        throw Object.assign(new Error("invite exhausted"), { status: 410 });

      // Check not already a member
      const existing = db
        .prepare(`SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?`)
        .get(invite.project_id, user.id);
      if (existing) throw Object.assign(new Error("already a member"), { status: 409 });

      // Atomically consume one use
      const claim = db
        .prepare(
          `UPDATE project_invites SET used_count = used_count + 1
           WHERE token = ? AND used_count < max_uses`
        )
        .run(token);
      if (claim.changes === 0) throw Object.assign(new Error("invite exhausted"), { status: 410 });

      db.prepare(
        `INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, 'member', ?)`
      ).run(invite.project_id, user.id, Date.now());

      return invite.project_id as string;
    });
    projectId = tx();
  } catch (e: any) {
    return sendErr(res, e);
  }

  const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId);
  res.json(project);
});

// ── GET /projects/:id/members ─────────────────────────────────────────────────
projectsRouter.get("/:id/members", requireAuth, (req, res) => {
  const user = (req as any).user;
  try {
    requireProjectMember(req.params["id"] as string, user.id);
  } catch (e) {
    return sendErr(res, e);
  }

  const members = db
    .prepare(
      `SELECT pm.user_id, pm.role, pm.added_at, u.username
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ?`
    )
    .all(req.params["id"] as string);

  res.json(members);
});

// ── DELETE /projects/:id/members/:userId ──────────────────────────────────────
projectsRouter.delete("/:id/members/:userId", requireAuth, (req, res) => {
  const user = (req as any).user;
  const projectId = req.params["id"] as string;
  const targetUserId = req.params["userId"] as string;

  // Allow self-leave; only owner can remove others
  if (targetUserId !== user.id) {
    try {
      requireProjectOwner(projectId, user.id);
    } catch (e) {
      return sendErr(res, e);
    }
  } else {
    // Self-leave: must be a member
    if (!getMember(projectId, user.id)) {
      return res.status(403).json({ error: "not a member" });
    }
    // Owner cannot leave (would leave project ownerless)
    const m = getMember(projectId, user.id)!;
    if (m.role === "owner") {
      return res.status(400).json({ error: "owner cannot leave; delete the project or transfer ownership first" });
    }
  }

  const result = db
    .prepare(`DELETE FROM project_members WHERE project_id = ? AND user_id = ?`)
    .run(projectId, targetUserId);

  if (result.changes === 0) return res.status(404).json({ error: "member not found" });
  res.json({ ok: true });
});

// ── PATCH /chats/:chatId — move chat to/from project ─────────────────────────
projectsRouter.patch("/chats/:chatId", requireAuth, (req, res) => {
  const user = (req as any).user;
  const { projectId } = req.body ?? {};

  const chat = db
    .prepare(`SELECT * FROM chats WHERE id = ?`)
    .get(req.params["chatId"] as string) as any;

  if (!chat) return res.status(404).json({ error: "chat not found" });
  if (chat.user_id !== user.id) return res.status(403).json({ error: "not your chat" });

  if (projectId !== undefined && projectId !== null) {
    // Must be member of target project
    if (!getMember(projectId, user.id)) {
      return res.status(403).json({ error: "not a member of target project" });
    }
  }

  db.prepare(`UPDATE chats SET project_id = ?, updated_at = ? WHERE id = ?`)
    .run(projectId ?? null, Date.now(), req.params["chatId"] as string);

  const updated = db.prepare(`SELECT * FROM chats WHERE id = ?`).get(req.params["chatId"] as string);
  res.json(updated);
});
