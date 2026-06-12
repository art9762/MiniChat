// Per-user workspace container manager (see ADR-001 / Phase 1).
//
// Each user gets a persistent named volume `mc-ws-<userId>` mounted at
// /workspace and a disposable, on-demand container `mc-ws-<userId>` running the
// workspace image. Containers are hardened (non-root, no-new-privileges,
// mem/cpu/pids limits, no docker socket) and reach the host only via the agent
// billing proxy through host.docker.internal.
//
// The Trinity keys never enter a container: the container receives a fresh,
// scoped workspace billing token as ANTHROPIC_API_KEY, hashed (bcrypt) into
// `workspaces.ws_token_hash` so the agent-proxy (Phase 2) can verify it.
import Docker from "dockerode";
import bcrypt from "bcryptjs";
import { Writable } from "stream";
import { db, type User, type Workspace, type WorkspaceStatus } from "./db.js";
import { generateWorkspaceToken } from "./crypto.js";
import {
  workspaceImage,
  workspaceIdleMinutes,
  DEFAULT_DISK_QUOTA_BYTES,
  agentProxyBaseUrl,
} from "./env.js";

const docker = new Docker();

// ── naming ───────────────────────────────────────────────────────────────────

const containerName = (userId: string) => `mc-ws-${userId}`;
const volumeName = (userId: string) => `mc-ws-${userId}`;

// Container hard limits (ADR-001).
const MEM_LIMIT = 2 * 1024 * 1024 * 1024; // 2 GiB
const NANO_CPUS = 2_000_000_000; // 2 CPUs
const PIDS_LIMIT = 512;

// ── docker availability guard ──────────────────────────────────────────────────

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

// Thrown when the docker daemon is unreachable; routes map this to a 503.
export class DockerUnavailableError extends Error {
  constructor(message = "docker unavailable") {
    super(message);
    this.name = "DockerUnavailableError";
  }
}

// Wrap a dockerode call: a connection-level failure (daemon down) becomes a
// DockerUnavailableError so callers can return a clean 503 instead of crashing.
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    if (isDaemonDownError(e)) throw new DockerUnavailableError();
    throw e;
  }
}

function isDaemonDownError(e: any): boolean {
  const code = e?.code || e?.errno;
  if (code === "ECONNREFUSED" || code === "ENOENT" || code === "EACCES") return true;
  const msg = String(e?.message || "");
  return /connect ENOENT|ECONNREFUSED|docker daemon|Cannot connect to the Docker/i.test(msg);
}

// A dockerode 404 (no such container/volume) — used to branch create-vs-reuse.
function isNotFound(e: any): boolean {
  return e?.statusCode === 404;
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

export function getWorkspaceState(userId: string): Workspace | undefined {
  return db.prepare(`SELECT * FROM workspaces WHERE user_id = ?`).get(userId) as
    | Workspace
    | undefined;
}

function upsertWorkspaceRow(user: User): Workspace {
  const existing = getWorkspaceState(user.id);
  if (existing) return existing;
  const quota = user.role === "admin" ? null : DEFAULT_DISK_QUOTA_BYTES;
  db.prepare(
    `INSERT INTO workspaces (user_id, volume_name, container_id, status, last_activity_at,
       disk_used_bytes, disk_quota_bytes, ws_token_hash, created_at)
     VALUES (?, ?, NULL, 'none', NULL, 0, ?, NULL, ?)`
  ).run(user.id, volumeName(user.id), quota, Date.now());
  return getWorkspaceState(user.id)!;
}

function setStatus(userId: string, status: WorkspaceStatus, containerId?: string | null) {
  if (containerId !== undefined) {
    db.prepare(`UPDATE workspaces SET status = ?, container_id = ? WHERE user_id = ?`).run(
      status,
      containerId,
      userId
    );
  } else {
    db.prepare(`UPDATE workspaces SET status = ? WHERE user_id = ?`).run(status, userId);
  }
}

export function touchActivity(userId: string) {
  db.prepare(`UPDATE workspaces SET last_activity_at = ? WHERE user_id = ?`).run(
    Date.now(),
    userId
  );
}

// ── volume / container lifecycle ────────────────────────────────────────────────

async function ensureVolume(userId: string): Promise<void> {
  const name = volumeName(userId);
  try {
    await docker.getVolume(name).inspect();
  } catch (e: any) {
    if (!isNotFound(e)) throw e;
    await docker.createVolume({
      Name: name,
      Labels: { "minichat.user": userId },
    });
  }
}

// Inspect the container by name; return undefined if it doesn't exist.
async function inspectContainer(userId: string) {
  try {
    const c = docker.getContainer(containerName(userId));
    const info = await c.inspect();
    return { container: c, info };
  } catch (e: any) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}

// Ensure the user's volume + container exist and the container is running.
// Returns the raw workspace billing token whenever a fresh one was minted
// (on create) so the caller may surface/keep it; undefined when an existing
// running container was reused without re-tokenising.
export async function ensureWorkspace(user: User): Promise<{ wsToken?: string }> {
  return guard(async () => {
    const userId = user.id;
    upsertWorkspaceRow(user);
    setStatus(userId, "starting");

    await ensureVolume(userId);

    const found = await inspectContainer(userId);

    // Reuse an already-running container as-is.
    if (found && found.info.State?.Running) {
      setStatus(userId, "running", found.info.Id);
      touchActivity(userId);
      return {};
    }

    // A fresh token is minted whenever we (re)create the container, because the
    // token is injected as an env var that only takes effect at create time.
    let wsToken: string | undefined;

    let container = found?.container;
    if (!container) {
      wsToken = generateWorkspaceToken();
      persistToken(userId, wsToken);
      container = await createContainer(userId, wsToken);
    } else {
      // Container exists but is stopped. Env vars are baked at create time, so
      // to guarantee a valid token we recreate it (the volume persists files).
      wsToken = generateWorkspaceToken();
      persistToken(userId, wsToken);
      try {
        await container.remove({ force: true });
      } catch (e: any) {
        if (!isNotFound(e)) throw e;
      }
      container = await createContainer(userId, wsToken);
    }

    await container.start();
    const info = await container.inspect();
    setStatus(userId, "running", info.Id);
    touchActivity(userId);
    return { wsToken };
  });
}

function persistToken(userId: string, rawToken: string) {
  const hash = bcrypt.hashSync(rawToken, 10);
  db.prepare(`UPDATE workspaces SET ws_token_hash = ? WHERE user_id = ?`).run(hash, userId);
}

async function createContainer(userId: string, wsToken: string) {
  return docker.createContainer({
    name: containerName(userId),
    Image: workspaceImage(),
    User: "node", // non-root
    WorkingDir: "/workspace",
    Cmd: ["sleep", "infinity"], // keep alive for docker exec
    Labels: { "minichat.user": userId },
    Env: [
      `ANTHROPIC_BASE_URL=${agentProxyBaseUrl()}`,
      `ANTHROPIC_API_KEY=${wsToken}`,
    ],
    HostConfig: {
      Memory: MEM_LIMIT,
      NanoCpus: NANO_CPUS,
      PidsLimit: PIDS_LIMIT,
      SecurityOpt: ["no-new-privileges:true"],
      ExtraHosts: ["host.docker.internal:host-gateway"],
      Binds: [`${volumeName(userId)}:/workspace`],
    },
  });
}

export async function stopWorkspace(userId: string): Promise<void> {
  return guard(async () => {
    const found = await inspectContainer(userId);
    if (found && found.info.State?.Running) {
      try {
        await found.container.stop({ t: 5 });
      } catch (e: any) {
        // 304 = already stopped; ignore.
        if (e?.statusCode !== 304 && !isNotFound(e)) throw e;
      }
    }
    setStatus(userId, "stopped");
  });
}

export async function removeWorkspace(
  userId: string,
  opts: { wipeVolume?: boolean } = {}
): Promise<void> {
  return guard(async () => {
    const found = await inspectContainer(userId);
    if (found) {
      try {
        await found.container.remove({ force: true });
      } catch (e: any) {
        if (!isNotFound(e)) throw e;
      }
    }
    if (opts.wipeVolume) {
      try {
        await docker.getVolume(volumeName(userId)).remove({ force: true });
      } catch (e: any) {
        if (!isNotFound(e)) throw e;
      }
      db.prepare(
        `UPDATE workspaces SET disk_used_bytes = 0, ws_token_hash = NULL WHERE user_id = ?`
      ).run(userId);
    }
    setStatus(userId, "none", null);
  });
}

// ── exec ─────────────────────────────────────────────────────────────────────

// Options for the streaming exec (agent runner). `stdin`, if given, is written
// to the process once; the stream stays open for the caller to read.
export interface ExecStreamOptions {
  stdin?: string;
  tty?: boolean;
  // Additive (beyond the locked {stdin,tty}); container WORKDIR is /workspace.
  workingDir?: string;
  env?: string[];
}

// Options for the buffered exec (files API). `stdin` is piped into the process
// and the stdin side is closed (EOF); output is collected until exit.
export interface ExecCaptureOptions {
  stdin?: string | Buffer;
  user?: string;
  workingDir?: string;
  env?: string[];
}

// Return the dockerode Container handle for a user's workspace (exposed for
// putArchive/getArchive in the files API). Throws if it doesn't exist; tagged
// DockerUnavailableError if the daemon is down.
export async function getContainer(userId: string): Promise<Docker.Container> {
  return guard(async () => {
    const found = await inspectContainer(userId);
    if (!found) throw new Error("workspace container does not exist");
    return found.container;
  });
}

// Create + start an exec and return the live (hijacked) duplex stream paired
// with its dockerode Exec handle (inspect it for the exit code; the agent
// runner kills the run by closing the stream / killing the process). With
// `tty: true` the stream is un-multiplexed (clean stdout — what an NDJSON
// reader wants); with `tty: false` the caller demuxes via
// `getContainer(userId).modem.demuxStream`. Throws if not running.
export async function execInWorkspace(
  userId: string,
  argv: string[],
  opts: ExecStreamOptions = {}
): Promise<{ stream: NodeJS.ReadWriteStream; exec: Docker.Exec }> {
  return guard(async () => {
    const found = await inspectContainer(userId);
    if (!found) throw new Error("workspace container does not exist");
    if (!found.info.State?.Running) throw new Error("workspace container is not running");

    const hasStdin = opts.stdin !== undefined;
    const exec = await found.container.exec({
      Cmd: argv,
      AttachStdin: hasStdin,
      AttachStdout: true,
      AttachStderr: true,
      Tty: opts.tty ?? false,
      WorkingDir: opts.workingDir,
      Env: opts.env,
    });
    const stream = await exec.start({ hijack: true, stdin: hasStdin, Tty: opts.tty ?? false });
    // Write the prompt/input once; leave the stream open for reading.
    if (hasStdin) (stream as unknown as NodeJS.WritableStream).write(opts.stdin!);
    touchActivity(userId);
    return { stream: stream as unknown as NodeJS.ReadWriteStream, exec };
  });
}

// Convenience: run a command (no shell — argv array), optionally piping
// `opts.stdin` in (then half-closing stdin so the process sees EOF), buffer
// demuxed stdout/stderr, return the exit code.
export async function execCapture(
  userId: string,
  argv: string[],
  opts: ExecCaptureOptions = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const found = await guard(() => inspectContainer(userId));
  if (!found) throw new Error("workspace container does not exist");
  if (!found.info.State?.Running) throw new Error("workspace container is not running");

  const hasStdin = opts.stdin !== undefined;
  const exec = await guard(() =>
    found.container.exec({
      Cmd: argv,
      AttachStdin: hasStdin,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: opts.user,
      WorkingDir: opts.workingDir,
      Env: opts.env,
    })
  );

  const stream = await guard(() => exec.start({ hijack: true, stdin: hasStdin }));

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      stdoutChunks.push(Buffer.from(chunk));
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      stderrChunks.push(Buffer.from(chunk));
      cb();
    },
  });

  // Demux the multiplexed (non-TTY) exec stream into stdout/stderr.
  found.container.modem.demuxStream(stream, stdout, stderr);

  // Pipe input then half-close stdin so the process sees EOF.
  if (hasStdin) {
    (stream as unknown as NodeJS.WritableStream).write(opts.stdin!);
    (stream as unknown as NodeJS.WritableStream).end();
  }

  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("close", resolve);
    stream.on("error", reject);
  });

  const info = await exec.inspect();
  touchActivity(userId);
  return {
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
    exitCode: info.ExitCode ?? 0,
  };
}

// ── disk usage ─────────────────────────────────────────────────────────────────

// Measure /workspace size with `du -sb`, cache into workspaces.disk_used_bytes.
// On any failure, fall back to the cached value (never throw to the caller).
export async function getDiskUsage(userId: string): Promise<number> {
  const cached = getWorkspaceState(userId)?.disk_used_bytes ?? 0;
  try {
    const { stdout, exitCode } = await execCapture(userId, ["du", "-sb", "/workspace"]);
    if (exitCode !== 0) return cached;
    const match = stdout.trim().match(/^(\d+)/);
    if (!match) return cached;
    const bytes = parseInt(match[1], 10);
    db.prepare(`UPDATE workspaces SET disk_used_bytes = ? WHERE user_id = ?`).run(bytes, userId);
    return bytes;
  } catch {
    return cached;
  }
}

// ── idle reaper ─────────────────────────────────────────────────────────────────

let reaper: NodeJS.Timeout | null = null;

// Stop running containers idle longer than WORKSPACE_IDLE_MINUTES. Runs every
// 60s; .unref()'d so it never keeps the process alive. Idempotent.
export function startIdleReaper(): NodeJS.Timeout {
  if (reaper) return reaper;
  reaper = setInterval(async () => {
    try {
      if (!(await isDockerAvailable())) return;
      const cutoff = Date.now() - workspaceIdleMinutes() * 60_000;
      const rows = db
        .prepare(`SELECT user_id, last_activity_at FROM workspaces WHERE status = 'running'`)
        .all() as { user_id: string; last_activity_at: number | null }[];
      for (const row of rows) {
        if (row.last_activity_at !== null && row.last_activity_at < cutoff) {
          try {
            await stopWorkspace(row.user_id);
          } catch {
            /* best-effort; next tick retries */
          }
        }
      }
    } catch {
      /* swallow — reaper must never crash the process */
    }
  }, 60_000);
  reaper.unref();
  return reaper;
}
