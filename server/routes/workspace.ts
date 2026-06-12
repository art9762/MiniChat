// Per-user workspace REST API (Phase 1). All routes are scoped strictly to the
// authenticated user (req.user!.id) — no userId is ever accepted from the
// client, which closes the IDOR surface called out in the PLAN.
//
// Mounted at /api/workspace by index.ts.
import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import type { WorkspaceDTO } from "../lib/agentTypes.js";
import {
  ensureWorkspace,
  stopWorkspace,
  removeWorkspace,
  getWorkspaceState,
  getDiskUsage,
  DockerUnavailableError,
} from "../lib/docker.js";

export const workspaceRouter = Router();

workspaceRouter.use(requireAuth);

// Map a DB workspace row (+ live disk usage) to the client DTO.
function toDTO(userId: string, diskUsedBytes: number): WorkspaceDTO {
  const row = getWorkspaceState(userId);
  return {
    status: row?.status ?? "none",
    diskUsedBytes,
    diskQuotaBytes: row?.disk_quota_bytes ?? null,
    lastActivityAt: row?.last_activity_at ?? null,
  };
}

// Turn a docker-down error into a clean 503; rethrow anything else.
function handleDockerError(res: import("express").Response, e: unknown): boolean {
  if (e instanceof DockerUnavailableError) {
    res.status(503).json({ error: "docker unavailable" });
    return true;
  }
  return false;
}

// GET /api/workspace — status + disk + quota. Refreshes disk usage if running.
workspaceRouter.get("/", async (req, res) => {
  const userId = req.user!.id;
  const row = getWorkspaceState(userId);
  let diskUsed = row?.disk_used_bytes ?? 0;
  if (row?.status === "running") {
    try {
      diskUsed = await getDiskUsage(userId);
    } catch {
      /* keep cached value */
    }
  }
  res.json(toDTO(userId, diskUsed));
});

// POST /api/workspace/start — ensure volume + container exist and are running.
workspaceRouter.post("/start", async (req, res) => {
  const userId = req.user!.id;
  try {
    await ensureWorkspace(req.user!);
    const diskUsed = getWorkspaceState(userId)?.disk_used_bytes ?? 0;
    res.json(toDTO(userId, diskUsed));
  } catch (e) {
    if (handleDockerError(res, e)) return;
    console.error("[workspace] start failed:", e);
    res.status(500).json({ error: "failed to start workspace" });
  }
});

// POST /api/workspace/stop — stop the container (volume + files persist).
workspaceRouter.post("/stop", async (req, res) => {
  const userId = req.user!.id;
  try {
    await stopWorkspace(userId);
    const diskUsed = getWorkspaceState(userId)?.disk_used_bytes ?? 0;
    res.json(toDTO(userId, diskUsed));
  } catch (e) {
    if (handleDockerError(res, e)) return;
    console.error("[workspace] stop failed:", e);
    res.status(500).json({ error: "failed to stop workspace" });
  }
});

// POST /api/workspace/reset — wipe the volume (destructive). Requires
// { confirm: true } in the body so it can't be triggered accidentally.
workspaceRouter.post("/reset", async (req, res) => {
  const userId = req.user!.id;
  if (req.body?.confirm !== true) {
    return res.status(400).json({ error: "reset requires { confirm: true }" });
  }
  try {
    await removeWorkspace(userId, { wipeVolume: true });
    const diskUsed = getWorkspaceState(userId)?.disk_used_bytes ?? 0;
    res.json(toDTO(userId, diskUsed));
  } catch (e) {
    if (handleDockerError(res, e)) return;
    console.error("[workspace] reset failed:", e);
    res.status(500).json({ error: "failed to reset workspace" });
  }
});
