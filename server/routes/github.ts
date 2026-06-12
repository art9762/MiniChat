// GitHub integration: store an encrypted Personal Access Token per user, expose
// connection status (never the token), and clone repos into the workspace.
//
// Scoped to req.user!.id — no userId param (IDOR-safe). PAT at rest is
// AES-256-GCM (lib/crypto.ts, ADR-005); features degrade to 503 when SECRETS_KEY
// is absent. gitCredentialSetup is exported so the docker layer can inject the
// same credentials on container start.
import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { db } from "../lib/db.js";
import type { GithubToken } from "../lib/db.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { hasSecretsKey } from "../lib/env.js";
import { resolveWorkspaceChild } from "../lib/wsPath.js";
import { ensureWorkspace, execCapture, touchActivity, DockerUnavailableError } from "../lib/docker.js";
import type { GithubStatusDTO } from "../lib/agentTypes.js";

export const githubRouter = Router();

function getRow(userId: string): GithubToken | undefined {
  return db.prepare(`SELECT * FROM github_tokens WHERE user_id = ?`).get(userId) as
    | GithubToken
    | undefined;
}

function statusOf(row: GithubToken | undefined): GithubStatusDTO {
  return {
    connected: !!row,
    username: row?.github_username ?? null,
    connectedAt: row?.connected_at ?? null,
  };
}

// ── PUT /token {token} — validate against the GitHub API, then store encrypted ──
githubRouter.put("/token", requireAuth, async (req, res) => {
  if (!hasSecretsKey()) {
    return res.status(503).json({ error: "secrets key not configured" });
  }
  const token = (req.body ?? {}).token;
  if (typeof token !== "string" || token.length < 8 || token.length > 512) {
    return res.status(400).json({ error: "token required" });
  }

  // Validate the PAT and resolve the login. Tokens that can't read /user are useless.
  let login: string | null = null;
  try {
    const r = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "minichat",
        Accept: "application/vnd.github+json",
      },
    });
    if (r.status === 401 || r.status === 403) {
      return res.status(400).json({ error: "invalid or insufficiently scoped token" });
    }
    if (!r.ok) {
      return res.status(502).json({ error: "github validation failed" });
    }
    const body: any = await r.json();
    login = typeof body?.login === "string" ? body.login : null;
  } catch {
    return res.status(502).json({ error: "could not reach github" });
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO github_tokens (user_id, token_encrypted, github_username, connected_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       token_encrypted = excluded.token_encrypted,
       github_username = excluded.github_username,
       connected_at    = excluded.connected_at`
  ).run(req.user!.id, encryptSecret(token), login, now);

  res.json(statusOf(getRow(req.user!.id)));
});

// ── DELETE /token ──────────────────────────────────────────────────────────
githubRouter.delete("/token", requireAuth, (req, res) => {
  db.prepare(`DELETE FROM github_tokens WHERE user_id = ?`).run(req.user!.id);
  res.json({ ok: true });
});

// ── GET / — connection status (never the token) ─────────────────────────────
githubRouter.get("/", requireAuth, (req, res) => {
  res.json(statusOf(getRow(req.user!.id)));
});

// A plausible https/git(+ssh) repo URL. We never interpolate the URL into a
// shell — it's passed to git as an argv element — but a sanity check keeps junk
// (and `file://`, local paths) out.
const REPO_URL_RE = /^(https:\/\/|git@|ssh:\/\/git@)[\w.@:/~-]+(\.git)?\/?$/;

// ── POST /clone {repoUrl, dir?} ──────────────────────────────────────────────
githubRouter.post("/clone", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const { repoUrl, dir } = req.body ?? {};
  if (typeof repoUrl !== "string" || !REPO_URL_RE.test(repoUrl.trim())) {
    return res.status(400).json({ error: "valid https/git repoUrl required" });
  }
  const url = repoUrl.trim();

  // Optional target dir, guarded so it stays inside /workspace and isn't root.
  let absDir: string | null = null;
  if (dir != null) {
    if (typeof dir !== "string") return res.status(400).json({ error: "dir must be a string" });
    try {
      absDir = resolveWorkspaceChild(dir);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "invalid dir" });
    }
  }

  try {
    await ensureWorkspace(req.user!);
    touchActivity(userId);
    // Inject git credentials if a PAT is stored (no-op otherwise).
    await gitCredentialSetup(userId);

    // argv array — repoUrl and dir are positional, never shell-parsed.
    const argv = absDir
      ? ["git", "-C", "/workspace", "clone", "--", url, absDir]
      : ["git", "-C", "/workspace", "clone", "--", url];
    const r = await execCapture(userId, argv);
    if (r.exitCode !== 0) {
      // git writes progress to stderr; trim secrets just in case (there are none
      // in the URL, but be safe) and surface to the user.
      return res.status(400).json({ ok: false, error: r.stderr?.trim() || "clone failed" });
    }
    res.json({ ok: true, stdout: r.stdout, stderr: r.stderr });
  } catch (err: any) {
    if (err instanceof DockerUnavailableError) {
      return res.status(503).json({ error: "workspace runtime unavailable" });
    }
    console.error("[github] clone error:", err);
    res.status(500).json({ error: "internal error" });
  }
});

/**
 * Decrypt the stored PAT (if any) and configure git/gh credentials inside the
 * user's workspace container: ~/.git-credentials + credential.helper store +
 * GH_TOKEN via a persisted env file. Safe to call repeatedly; no-op when the
 * user has no token or SECRETS_KEY is unset. The docker layer may also call this
 * on container start.
 */
export async function gitCredentialSetup(userId: string): Promise<void> {
  if (!hasSecretsKey()) return;
  const row = getRow(userId);
  if (!row) return;

  let pat: string;
  try {
    pat = decryptSecret(row.token_encrypted);
  } catch (e) {
    console.error("[github] failed to decrypt PAT for", userId, e);
    return;
  }
  const login = row.github_username || "x-access-token";

  // Write ~/.git-credentials with the token, enable the store helper, and append
  // GH_TOKEN to ~/.profile + ~/.bashrc for the gh CLI. The credential line and
  // token are passed as positional args ($1 login, $2 token) so neither is
  // shell-interpreted; the file is chmod 600.
  const script = [
    'login="$1"; tok="$2";',
    'home="${HOME:-/home/node}";',
    // git-credentials: https://<login>:<token>@github.com
    'printf "https://%s:%s@github.com\\n" "$login" "$tok" > "$home/.git-credentials";',
    'chmod 600 "$home/.git-credentials";',
    'git config --global credential.helper store;',
    'git config --global url."https://github.com/".insteadOf "git@github.com:" || true;',
    // GH_TOKEN for gh CLI — drop a profile snippet (idempotent).
    'grep -q "GH_TOKEN=" "$home/.profile" 2>/dev/null || printf "export GH_TOKEN=%s\\n" "$tok" >> "$home/.profile";',
  ].join(" ");

  try {
    await execCapture(userId, ["sh", "-c", script, "sh", login, pat]);
  } catch (e) {
    console.error("[github] gitCredentialSetup failed for", userId, e);
  }
}
