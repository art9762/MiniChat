// File system API for the per-user workspace container (mounted at /workspace).
//
// Every route is requireAuth + filesLimiter and scoped to req.user!.id — there
// is no userId path param, so a user can only ever touch their own container
// (IDOR-safe by construction). All user-supplied paths pass through
// resolveWorkspacePath (see lib/wsPath.ts) which refuses anything escaping
// /workspace.
//
// Implementation notes (see also team handoff): docker.ts only guarantees
// execCapture(userId, argv) → {stdout,stderr,exitCode}, so all I/O goes through
// `docker exec` with an **argv array** (never `sh -c "<interpolated user data>"`).
// Binary-safe transport is base64: reads/downloads `base64`-encode in the
// container and we decode here; writes/uploads base64-encode here and pipe to
// `base64 -d` in the container, chunked to stay under ARG_MAX. User-controlled
// values (paths, content) are always passed as positional args ($1, $2…) to a
// fixed script string, so they can never be interpreted as shell.
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../lib/auth.js";
import { filesLimiter } from "../lib/rateLimit.js";
import { resolveWorkspacePath, resolveWorkspaceChild, WORKSPACE_ROOT } from "../lib/wsPath.js";
import {
  ensureWorkspace,
  execCapture,
  getDiskUsage,
  getWorkspaceState,
  touchActivity,
  DockerUnavailableError,
} from "../lib/docker.js";
import type { FileEntryDTO } from "../lib/agentTypes.js";

export const filesRouter = Router();

const MAX_READ_BYTES = 2 * 1024 * 1024; // 2 MiB cap for GET /content
const UPLOAD_MAX_BYTES = 50 * 1024 * 1024; // 50 MiB cap for a single upload
// base64 chars per exec when writing — multiple of 4 so each chunk decodes
// independently (concatenated decodes == whole-buffer decode). 256 KiB of b64.
const WRITE_CHUNK = 256 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
});

// ── helpers ──────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Run argv in the container, throwing an HttpError(500) on a non-zero exit
// unless `allowFail` is set (caller inspects exitCode/stderr itself).
async function run(
  userId: string,
  argv: string[],
  allowFail = false
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const r = await execCapture(userId, argv);
  if (!allowFail && r.exitCode !== 0) {
    throw new HttpError(500, r.stderr?.trim() || `command failed (exit ${r.exitCode})`);
  }
  return r;
}

// Write a buffer to an absolute container path, chunked via base64 to avoid
// ARG_MAX. Creates parent dirs and truncates first. Pure-execCapture so it does
// not depend on exec stdin or a container accessor.
async function writeBytes(userId: string, abs: string, buf: Buffer): Promise<void> {
  // mkdir -p parent && truncate. abs is a positional arg ($1) — never interpolated.
  const init = await run(
    userId,
    ["sh", "-c", 'mkdir -p "$(dirname "$1")" && : > "$1"', "sh", abs],
    true
  );
  if (init.exitCode !== 0) {
    throw new HttpError(500, init.stderr?.trim() || "failed to create file");
  }
  const b64 = buf.toString("base64");
  for (let i = 0; i < b64.length; i += WRITE_CHUNK) {
    const part = b64.slice(i, i + WRITE_CHUNK);
    const r = await run(
      userId,
      ["sh", "-c", 'printf %s "$2" | base64 -d >> "$1"', "sh", abs, part],
      true
    );
    if (r.exitCode !== 0) {
      throw new HttpError(500, r.stderr?.trim() || "failed to write file");
    }
  }
}

// Translate thrown errors (HttpError or path-guard Error) into a JSON response.
function fail(res: any, err: unknown) {
  if (err instanceof DockerUnavailableError) {
    return res.status(503).json({ error: "workspace runtime unavailable" });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  const msg = err instanceof Error ? err.message : "error";
  // Path-guard messages are client faults (bad input) → 400.
  if (/workspace|null byte|must be a string|not allowed/i.test(msg)) {
    return res.status(400).json({ error: msg });
  }
  console.error("[files] unexpected error:", err);
  return res.status(500).json({ error: "internal error" });
}

// ── routes ─────────────────────────────────────────────────────────────────

// GET /?path= — directory listing as FileEntryDTO[].
filesRouter.get("/", requireAuth, filesLimiter, async (req, res) => {
  const userId = req.user!.id;
  try {
    const abs = resolveWorkspacePath(typeof req.query.path === "string" ? req.query.path : "");
    await ensureWorkspace(req.user!);
    touchActivity(userId);

    // node is present in the workspace image (node:22-bookworm). The script
    // takes the dir as argv[1]; emits a JSON array. No user data is in the
    // script body.
    const script = `
      const fs = require('fs');
      const p = process.argv[1];
      let ents;
      try { ents = fs.readdirSync(p, { withFileTypes: true }); }
      catch (e) { console.error(e.code || e.message); process.exit(e.code === 'ENOENT' ? 44 : 1); }
      const out = [];
      for (const d of ents) {
        let st; try { st = fs.statSync(p + '/' + d.name); } catch { continue; }
        out.push({ name: d.name, type: d.isDirectory() ? 'dir' : 'file', size: st.size, mtime: Math.floor(st.mtimeMs) });
      }
      process.stdout.write(JSON.stringify(out));
    `;
    const r = await run(userId, ["node", "-e", script, abs], true);
    if (r.exitCode === 44) throw new HttpError(404, "not found");
    if (r.exitCode !== 0) throw new HttpError(500, r.stderr?.trim() || "listing failed");
    const entries = JSON.parse(r.stdout || "[]") as FileEntryDTO[];
    entries.sort((a, b) =>
      a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name)
    );
    res.json(entries);
  } catch (err) {
    fail(res, err);
  }
});

// GET /content?path= — file contents (text only; binary → 415, >2MiB → 413).
filesRouter.get("/content", requireAuth, filesLimiter, async (req, res) => {
  const userId = req.user!.id;
  try {
    const rel = typeof req.query.path === "string" ? req.query.path : "";
    const abs = resolveWorkspaceChild(rel);
    await ensureWorkspace(req.user!);
    touchActivity(userId);

    // One round-trip: stat + binary sniff + base64 content (so we never corrupt
    // bytes through the string stdout). LIMIT passed as argv[2].
    const script = `
      const fs = require('fs');
      const p = process.argv[1];
      const limit = parseInt(process.argv[2], 10);
      let st;
      try { st = fs.statSync(p); }
      catch { console.error('ENOENT'); process.exit(44); }
      if (st.isDirectory()) { console.error('EISDIR'); process.exit(45); }
      if (st.size > limit) { process.stdout.write(JSON.stringify({ tooLarge: true, size: st.size })); process.exit(0); }
      const buf = fs.readFileSync(p);
      const sniff = buf.subarray(0, 8192);
      let binary = false;
      for (let i = 0; i < sniff.length; i++) { if (sniff[i] === 0) { binary = true; break; } }
      if (binary) { process.stdout.write(JSON.stringify({ binary: true })); process.exit(0); }
      process.stdout.write(JSON.stringify({ b64: buf.toString('base64'), size: st.size }));
    `;
    const r = await run(userId, ["node", "-e", script, abs, String(MAX_READ_BYTES)], true);
    if (r.exitCode === 44) throw new HttpError(404, "not found");
    if (r.exitCode === 45) throw new HttpError(400, "path is a directory");
    if (r.exitCode !== 0) throw new HttpError(500, r.stderr?.trim() || "read failed");

    const parsed = JSON.parse(r.stdout || "{}");
    if (parsed.tooLarge) throw new HttpError(413, `file too large (${parsed.size} bytes, limit ${MAX_READ_BYTES})`);
    if (parsed.binary) throw new HttpError(415, "binary file — use download");
    const content = Buffer.from(parsed.b64, "base64").toString("utf8");
    res.json({ content, path: rel });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /content {path, content} — write a (text) file.
filesRouter.put("/content", requireAuth, filesLimiter, async (req, res) => {
  const userId = req.user!.id;
  try {
    const { path: rel, content } = req.body ?? {};
    if (typeof rel !== "string" || typeof content !== "string") {
      throw new HttpError(400, "path and content (strings) required");
    }
    if (Buffer.byteLength(content, "utf8") > MAX_READ_BYTES) {
      throw new HttpError(413, `content too large (limit ${MAX_READ_BYTES} bytes)`);
    }
    const abs = resolveWorkspaceChild(rel);
    await ensureWorkspace(req.user!);
    touchActivity(userId);
    await writeBytes(userId, abs, Buffer.from(content, "utf8"));
    res.json({ ok: true, path: rel });
  } catch (err) {
    fail(res, err);
  }
});

// POST /mkdir {path}
filesRouter.post("/mkdir", requireAuth, filesLimiter, async (req, res) => {
  const userId = req.user!.id;
  try {
    const rel = (req.body ?? {}).path;
    if (typeof rel !== "string") throw new HttpError(400, "path required");
    const abs = resolveWorkspaceChild(rel);
    await ensureWorkspace(req.user!);
    touchActivity(userId);
    await run(userId, ["mkdir", "-p", "--", abs]);
    res.json({ ok: true, path: rel });
  } catch (err) {
    fail(res, err);
  }
});

// POST /rename {from, to}
filesRouter.post("/rename", requireAuth, filesLimiter, async (req, res) => {
  const userId = req.user!.id;
  try {
    const { from, to } = req.body ?? {};
    if (typeof from !== "string" || typeof to !== "string") {
      throw new HttpError(400, "from and to required");
    }
    const absFrom = resolveWorkspaceChild(from);
    const absTo = resolveWorkspaceChild(to);
    await ensureWorkspace(req.user!);
    touchActivity(userId);
    // mkdir -p parent of target, then mv. Both paths positional ($1 source, $2 dest).
    const r = await run(
      userId,
      ["sh", "-c", 'mkdir -p "$(dirname "$2")" && mv -- "$1" "$2"', "sh", absFrom, absTo],
      true
    );
    if (r.exitCode !== 0) {
      // mv on a missing source is the common case.
      throw new HttpError(/No such file/i.test(r.stderr) ? 404 : 500, r.stderr?.trim() || "rename failed");
    }
    res.json({ ok: true, from, to });
  } catch (err) {
    fail(res, err);
  }
});

// POST /delete {path} — rm -rf, but the path guard forbids the workspace root.
filesRouter.post("/delete", requireAuth, filesLimiter, async (req, res) => {
  const userId = req.user!.id;
  try {
    const rel = (req.body ?? {}).path;
    if (typeof rel !== "string") throw new HttpError(400, "path required");
    const abs = resolveWorkspaceChild(rel); // throws on /workspace root
    await ensureWorkspace(req.user!);
    touchActivity(userId);
    await run(userId, ["rm", "-rf", "--", abs]);
    res.json({ ok: true, path: rel });
  } catch (err) {
    fail(res, err);
  }
});

// POST /upload (multipart, field "file") {path: dir} — store the upload in the
// container. Enforces the disk quota (413 when at/over quota).
filesRouter.post("/upload", requireAuth, filesLimiter, upload.single("file"), async (req, res) => {
  const userId = req.user!.id;
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) throw new HttpError(400, "file is required (multipart field 'file')");
    const dirRel = typeof req.body?.path === "string" ? req.body.path : "";
    const absDir = resolveWorkspacePath(dirRel);
    // Final destination = dir + uploaded filename (basename only — strip any path).
    const base = (file.originalname || "upload.bin").split("/").pop()!.split("\\").pop()!;
    const absFile = resolveWorkspaceChild(`${dirRel.replace(/\/+$/, "")}/${base}`);
    void absDir;

    await ensureWorkspace(req.user!);
    touchActivity(userId);

    // Quota: block when used >= quota (quota null = unlimited, e.g. admins).
    const state = getWorkspaceState(userId);
    const quota = state?.disk_quota_bytes ?? null;
    if (quota != null) {
      const used = await getDiskUsage(userId);
      if (used >= quota) {
        throw new HttpError(413, "disk quota exceeded");
      }
    }

    await writeBytes(userId, absFile, file.buffer);
    res.json({ ok: true, path: absFile.slice(WORKSPACE_ROOT.length) || "/", size: file.buffer.length });
  } catch (err) {
    fail(res, err);
  }
});

// GET /download?path= — single file streamed raw; directory streamed as .tar.gz.
// Transport is base64 through execCapture stdout (binary-safe); we decode and
// stream. Note: this buffers the encoded payload in memory — fine for the 2MiB
// file case and small/medium dirs; large-workspace export would want
// container.getArchive streaming once docker.ts exposes the container.
filesRouter.get("/download", requireAuth, filesLimiter, async (req, res) => {
  const userId = req.user!.id;
  try {
    const rel = typeof req.query.path === "string" ? req.query.path : "";
    const abs = resolveWorkspacePath(rel);
    await ensureWorkspace(req.user!);
    touchActivity(userId);

    // Determine file vs dir.
    const statR = await run(
      userId,
      ["sh", "-c", '[ -d "$1" ] && echo dir || { [ -e "$1" ] && echo file || echo none; }', "sh", abs],
      true
    );
    const kind = statR.stdout.trim();
    if (kind === "none") throw new HttpError(404, "not found");

    if (kind === "file") {
      const r = await run(userId, ["base64", "-w0", "--", abs], true);
      if (r.exitCode !== 0) throw new HttpError(500, r.stderr?.trim() || "download failed");
      const buf = Buffer.from(r.stdout.trim(), "base64");
      const name = abs.split("/").pop() || "file";
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/"/g, "")}"`);
      res.setHeader("Content-Length", String(buf.length));
      return res.end(buf);
    }

    // Directory → tar.gz. Build inside the container relative to /workspace so
    // archive paths are clean; pass the relative subpath as a positional arg.
    const subRel = abs === WORKSPACE_ROOT ? "." : abs.slice(WORKSPACE_ROOT.length + 1);
    const r = await run(
      userId,
      ["sh", "-c", 'cd /workspace && tar czf - -- "$1" | base64 -w0', "sh", subRel],
      true
    );
    if (r.exitCode !== 0) throw new HttpError(500, r.stderr?.trim() || "archive failed");
    const buf = Buffer.from(r.stdout.trim(), "base64");
    const baseName = abs === WORKSPACE_ROOT ? "workspace" : abs.split("/").pop() || "dir";
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${baseName}.tar.gz"`);
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
  } catch (err) {
    fail(res, err);
  }
});

// GET /usage — bytes used + quota (null = unlimited).
filesRouter.get("/usage", requireAuth, filesLimiter, async (req, res) => {
  const userId = req.user!.id;
  try {
    await ensureWorkspace(req.user!);
    touchActivity(userId);
    const usedBytes = await getDiskUsage(userId);
    const state = getWorkspaceState(userId);
    const quotaBytes = state?.disk_quota_bytes ?? null;
    res.json({ usedBytes, quotaBytes });
  } catch (err) {
    fail(res, err);
  }
});
