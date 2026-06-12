import type {
  AgentServerMessage,
  AgentClientMessage,
  AgentSessionDTO,
  WorkspaceDTO,
  FileEntryDTO,
  GithubStatusDTO,
} from "../agentTypes";

const API_BASE = "/api";

async function jsonFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "minichat",
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `HTTP ${res.status}`);
  return data;
}

const qs = (params: Record<string, string | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
};

export const api = {
  // auth
  me: () => jsonFetch("/auth/me"),
  login: (username: string, password: string) =>
    jsonFetch("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string, inviteCode: string) =>
    jsonFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, inviteCode }),
    }),
  logout: () => jsonFetch("/auth/logout", { method: "POST" }),
  redeem: (code: string) =>
    jsonFetch("/auth/redeem", { method: "POST", body: JSON.stringify({ code }) }),

  // models
  models: () => jsonFetch("/models"),

  // admin
  adminStats: () => jsonFetch("/admin/stats"),
  adminUsers: () => jsonFetch("/admin/users"),
  adminUpdateUser: (id: string, patch: any) =>
    jsonFetch(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  adminDeleteUser: (id: string) => jsonFetch(`/admin/users/${id}`, { method: "DELETE" }),
  adminInvites: () => jsonFetch("/admin/invites"),
  adminCreateInvite: () => jsonFetch("/admin/invites", { method: "POST" }),
  adminDeleteInvite: (code: string) =>
    jsonFetch(`/admin/invites/${code}`, { method: "DELETE" }),
  adminTokenCodes: () => jsonFetch("/admin/token-codes"),
  adminCreateTokenCode: (amount: number) =>
    jsonFetch("/admin/token-codes", { method: "POST", body: JSON.stringify({ amount }) }),
  adminDeleteTokenCode: (code: string) =>
    jsonFetch(`/admin/token-codes/${code}`, { method: "DELETE" }),

  // projects
  listProjects: () => jsonFetch("/projects"),
  createProject: (body: { name: string; description?: string; master_prompt?: string }) =>
    jsonFetch("/projects", { method: "POST", body: JSON.stringify(body) }),
  getProject: (id: string) => jsonFetch(`/projects/${id}`),
  updateProject: (id: string, patch: Record<string, string | null>) =>
    jsonFetch(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteProject: (id: string) => jsonFetch(`/projects/${id}`, { method: "DELETE" }),

  // project members
  removeMember: (projectId: string, userId: string) =>
    jsonFetch(`/projects/${projectId}/members/${userId}`, { method: "DELETE" }),

  // project invites
  createInvite: (projectId: string) =>
    jsonFetch(`/projects/${projectId}/invites`, { method: "POST", body: JSON.stringify({ maxUses: 1, expiresInHours: 72 }) }),
  joinProject: (token: string) =>
    jsonFetch(`/projects/join/${token}`, { method: "POST" }),

  // move chat
  moveChatToProject: (chatId: string, projectId: string | null) =>
    jsonFetch(`/projects/chats/${chatId}`, { method: "PATCH", body: JSON.stringify({ projectId }) }),

  // project files (P2 routes)
  listFiles: (projectId: string) => jsonFetch(`/projects/${projectId}/files`),
  uploadFile: (projectId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`/api/projects/${projectId}/files`, {
      method: "POST",
      credentials: "include",
      headers: { "X-Requested-With": "minichat" },
      body: fd,
    }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((d as any)?.error || `HTTP ${r.status}`);
      return d;
    });
  },
  deleteFile: (projectId: string, fileId: string) =>
    jsonFetch(`/projects/${projectId}/files/${fileId}`, { method: "DELETE" }),
  // chat attachments
  uploadChatAttachment: (chatId: string, file: File): Promise<{ id: string; name: string; mimeType: string; size: number; chatId: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`/api/chats/${chatId}/attachments`, {
      method: "POST",
      credentials: "include",
      headers: { "X-Requested-With": "minichat" },
      body: fd,
    }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((d as any)?.error || `HTTP ${r.status}`);
      return d;
    });
  },
  deleteChatAttachment: (chatId: string, attachmentId: string) =>
    jsonFetch(`/chats/${chatId}/attachments/${attachmentId}`, { method: "DELETE" }),

  // ── workspace ──────────────────────────────────────────────────────
  workspace: (): Promise<WorkspaceDTO> => jsonFetch("/workspace"),
  workspaceStart: () => jsonFetch("/workspace/start", { method: "POST" }),
  workspaceStop: () => jsonFetch("/workspace/stop", { method: "POST" }),
  workspaceReset: () =>
    jsonFetch("/workspace/reset", { method: "POST", body: JSON.stringify({ confirm: true }) }),

  // ── agent sessions ─────────────────────────────────────────────────
  // Backend returns a bare array; normalize to { sessions } for callers.
  agentSessions: async (): Promise<{ sessions: AgentSessionDTO[] }> => {
    const data = await jsonFetch("/agent/sessions");
    return { sessions: Array.isArray(data) ? data : data.sessions ?? [] };
  },
  // Backend returns the bare DTO (201); normalize to { session }.
  agentCreateSession: async (title?: string): Promise<{ session: AgentSessionDTO }> => {
    const data = await jsonFetch("/agent/sessions", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    return { session: data.session ?? data };
  },
  agentDeleteSession: (id: string) =>
    jsonFetch(`/agent/sessions/${id}`, { method: "DELETE" }),
  // Backend returns { session, events: [{ id, type, payload, createdAt }] }
  // where `payload` is the full AgentServerMessage. Flatten to messages.
  agentSessionEvents: async (id: string): Promise<{ events: AgentServerMessage[] }> => {
    const data = await jsonFetch(`/agent/sessions/${id}/events`);
    const raw: any[] = Array.isArray(data) ? data : data.events ?? [];
    const events = raw
      .map((e) => (e && e.payload ? e.payload : e))
      .filter((e): e is AgentServerMessage => e && typeof e.type === "string");
    return { events };
  },

  // ── files ──────────────────────────────────────────────────────────
  // Backend returns a bare array; normalize to { entries, path }.
  files: async (path = ""): Promise<{ entries: FileEntryDTO[]; path: string }> => {
    const data = await jsonFetch(`/files${qs({ path })}`);
    return { entries: Array.isArray(data) ? data : data.entries ?? [], path };
  },
  fileContent: (path: string): Promise<{ content: string; path: string }> =>
    jsonFetch(`/files/content${qs({ path })}`),
  fileWrite: (path: string, content: string) =>
    jsonFetch("/files/content", { method: "PUT", body: JSON.stringify({ path, content }) }),
  fileMkdir: (path: string) =>
    jsonFetch("/files/mkdir", { method: "POST", body: JSON.stringify({ path }) }),
  fileRename: (from: string, to: string) =>
    jsonFetch("/files/rename", { method: "POST", body: JSON.stringify({ from, to }) }),
  fileDelete: (path: string) =>
    jsonFetch("/files/delete", { method: "POST", body: JSON.stringify({ path }) }),
  filesUsage: (): Promise<{ usedBytes: number; quotaBytes: number | null }> =>
    jsonFetch("/files/usage"),
  fileUpload: async (dir: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_BASE}/files/upload${qs({ path: dir })}`, {
      method: "POST",
      credentials: "include",
      headers: { "X-Requested-With": "minichat" },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.error || `HTTP ${res.status}`);
    return data;
  },
  fileDownloadUrl: (path: string) => `${API_BASE}/files/download${qs({ path })}`,
  workspaceDownloadUrl: () => `${API_BASE}/files/download${qs({ path: "" })}`,

  // ── github ─────────────────────────────────────────────────────────
  github: (): Promise<GithubStatusDTO> => jsonFetch("/github"),
  githubSetToken: (token: string): Promise<GithubStatusDTO> =>
    jsonFetch("/github/token", { method: "PUT", body: JSON.stringify({ token }) }),
  githubDeleteToken: () => jsonFetch("/github/token", { method: "DELETE" }),
  githubClone: (repoUrl: string, dir?: string) =>
    jsonFetch("/github/clone", { method: "POST", body: JSON.stringify({ repoUrl, dir }) }),
};

export type StreamChunk =
  | { content: string }
  | { usage: { inputTokens: number; outputTokens: number; cost: number; balance: number } }
  | { error: string };

export async function* streamChat(body: {
  messages: { role: string; content: string }[];
  model: string;
  temperature?: number;
  systemPrompt?: string;
  chatId?: string;
  attachmentIds?: string[];
}): AsyncGenerator<StreamChunk> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "minichat",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as any).error || `HTTP ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        yield parsed as StreamChunk;
      } catch {}
    }
  }
}

// ── Agent WebSocket helper ───────────────────────────────────────────────────

export interface AgentSocketHandlers {
  onMessage: (msg: AgentServerMessage) => void;
  onOpen?: () => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: (ev: Event) => void;
}

export interface AgentSocket {
  send: (msg: AgentClientMessage) => void;
  close: () => void;
  readonly socket: WebSocket;
}

export function openAgentSocket(
  sessionId: string,
  handlers: AgentSocketHandlers
): AgentSocket {
  const url = new URL("/api/agent/ws", location.origin);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("session", sessionId);

  const ws = new WebSocket(url.toString());

  ws.addEventListener("open", () => handlers.onOpen?.());
  ws.addEventListener("close", (ev) => handlers.onClose?.(ev));
  ws.addEventListener("error", (ev) => handlers.onError?.(ev));
  ws.addEventListener("message", (ev) => {
    try {
      handlers.onMessage(JSON.parse(ev.data) as AgentServerMessage);
    } catch {
      // ignore malformed frames
    }
  });

  return {
    socket: ws,
    send: (msg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close: () => ws.close(),
  };
}
