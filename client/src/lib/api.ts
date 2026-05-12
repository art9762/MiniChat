const API_BASE = "/api";

async function jsonFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `HTTP ${res.status}`);
  return data;
}

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
}): AsyncGenerator<StreamChunk> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
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
