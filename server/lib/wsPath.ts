// Path-traversal guard for the per-user workspace (mounted at /workspace inside
// the container). All file operations resolve user-supplied relative paths
// through resolveWorkspacePath, which normalizes and refuses anything that would
// escape /workspace. POSIX semantics regardless of host OS (the container is
// linux), so we use path.posix throughout.
import path from "path";

export const WORKSPACE_ROOT = "/workspace";

/**
 * Resolve a user-supplied path (relative or absolute) into an absolute path that
 * is guaranteed to live under /workspace. Throws on traversal / null bytes.
 *
 * - A leading "/" is treated as workspace-relative (so "/src" => /workspace/src),
 *   matching how a file tree UI sends paths.
 * - "" / "." / "/" all resolve to the workspace root itself.
 */
export function resolveWorkspacePath(rel: string): string {
  if (typeof rel !== "string") {
    throw new Error("path must be a string");
  }
  if (rel.includes("\0")) {
    throw new Error("path contains null byte");
  }

  // Strip a leading slash so "/foo" is workspace-relative, not host-absolute.
  const relative = rel.replace(/^\/+/, "");

  // Join under the root and normalize away "." / ".." segments.
  const resolved = path.posix.normalize(path.posix.join(WORKSPACE_ROOT, relative));

  // Must be the root itself or a descendant. The trailing-slash check stops
  // "/workspace-evil" from passing a naive startsWith("/workspace").
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(WORKSPACE_ROOT + "/")) {
    throw new Error("path escapes workspace");
  }
  return resolved;
}

/**
 * Like resolveWorkspacePath but rejects the workspace root itself — used by
 * destructive ops (delete/rename target) so you can't rm -rf /workspace.
 */
export function resolveWorkspaceChild(rel: string): string {
  const resolved = resolveWorkspacePath(rel);
  if (resolved === WORKSPACE_ROOT) {
    throw new Error("operation not allowed on workspace root");
  }
  return resolved;
}
