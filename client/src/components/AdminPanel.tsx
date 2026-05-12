import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthProvider";

type AdminUser = {
  id: string;
  username: string;
  role: "user" | "admin";
  status: "active" | "suspended" | "banned";
  token_balance: number;
  created_at: number;
  requests: number;
  spent: number;
};

type Invite = {
  code: string;
  created_at: number;
  used_by: string | null;
  used_by_username: string | null;
};

type TokenCode = {
  code: string;
  amount: number;
  created_at: number;
  used_by: string | null;
  used_by_username: string | null;
};

interface Props {
  onClose: () => void;
}

export function AdminPanel({ onClose }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<"users" | "invites" | "tokens" | "stats">("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [tokenCodes, setTokenCodes] = useState<TokenCode[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [tokenAmount, setTokenAmount] = useState(10000);
  const [error, setError] = useState<string | null>(null);

  const loadAll = async () => {
    setError(null);
    try {
      const [u, i, t, s] = await Promise.all([
        api.adminUsers(),
        api.adminInvites(),
        api.adminTokenCodes(),
        api.adminStats(),
      ]);
      setUsers(u.users);
      setInvites(i.invites);
      setTokenCodes(t.codes);
      setStats(s);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const updateUser = async (id: string, patch: any) => {
    try {
      await api.adminUpdateUser(id, patch);
      await loadAll();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const createInvite = async () => {
    try {
      await api.adminCreateInvite();
      await loadAll();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const createTokenCode = async () => {
    try {
      await api.adminCreateTokenCode(tokenAmount);
      await loadAll();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const copy = (s: string) => navigator.clipboard.writeText(s);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-stretch sm:items-center justify-center sm:p-4">
      <div className="w-full sm:max-w-5xl h-full sm:h-[85vh] bg-[var(--bg-secondary)] border-0 sm:border border-[var(--border)] sm:rounded-2xl flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <h2 className="text-sm font-semibold">Админ-панель</h2>
          <button
            onClick={onClose}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1"
          >
            Закрыть ✕
          </button>
        </header>
        <div className="flex border-b border-[var(--border)] overflow-x-auto shrink-0">
          {(["users", "invites", "tokens", "stats"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                tab === t
                  ? "text-blue-400 border-b-2 border-blue-400"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t === "users"
                ? "Пользователи"
                : t === "invites"
                ? "Инвайты"
                : t === "tokens"
                ? "Коды токенов"
                : "Статистика"}
            </button>
          ))}
        </div>

        {error && (
          <div className="px-4 py-2 bg-red-500/10 text-red-400 text-xs border-b border-[var(--border)]">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "users" && (
            <div className="space-y-2">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="rounded-xl bg-[var(--bg-tertiary)] p-3 flex flex-wrap items-center gap-3"
                >
                  <div className="flex-1 min-w-[160px]">
                    <div className="text-sm font-medium flex items-center gap-2">
                      {u.username}
                      {u.role === "admin" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 uppercase">
                          admin
                        </span>
                      )}
                      <StatusBadge status={u.status} />
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      Запросов: {u.requests} · Списано: {u.spent}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="text-xs text-[var(--text-muted)]">Баланс:</span>
                    <input
                      type="number"
                      defaultValue={u.token_balance}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (n !== u.token_balance) updateUser(u.id, { token_balance: n });
                      }}
                      className="w-24 bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1 text-xs"
                    />
                  </div>

                  <select
                    value={u.status}
                    onChange={(e) => updateUser(u.id, { status: e.target.value })}
                    className="bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1 text-xs"
                  >
                    <option value="active">active</option>
                    <option value="suspended">suspended</option>
                    <option value="banned">banned</option>
                  </select>

                  {user?.id !== u.id && (
                    <select
                      value={u.role}
                      onChange={(e) => updateUser(u.id, { role: e.target.value })}
                      className="bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1 text-xs"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "invites" && (
            <div className="space-y-3">
              <button
                onClick={createInvite}
                className="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-3 py-2"
              >
                + Создать инвайт
              </button>
              <div className="space-y-1">
                {invites.map((i) => (
                  <div
                    key={i.code}
                    className="rounded-lg bg-[var(--bg-tertiary)] p-2.5 flex items-center gap-3 text-sm"
                  >
                    <code className="font-mono text-blue-400">{i.code}</code>
                    <button
                      onClick={() => copy(i.code)}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      copy
                    </button>
                    <div className="flex-1" />
                    {i.used_by ? (
                      <span className="text-xs text-[var(--text-muted)]">
                        использован: {i.used_by_username}
                      </span>
                    ) : (
                      <>
                        <span className="text-xs text-emerald-400">не использован</span>
                        <button
                          onClick={async () => {
                            await api.adminDeleteInvite(i.code);
                            loadAll();
                          }}
                          className="text-xs text-red-400 hover:underline"
                        >
                          удалить
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "tokens" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={tokenAmount}
                  onChange={(e) => setTokenAmount(Number(e.target.value))}
                  className="w-32 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={createTokenCode}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-3 py-2"
                >
                  + Создать код на {tokenAmount} токенов
                </button>
              </div>
              <div className="space-y-1">
                {tokenCodes.map((c) => (
                  <div
                    key={c.code}
                    className="rounded-lg bg-[var(--bg-tertiary)] p-2.5 flex items-center gap-3 text-sm"
                  >
                    <code className="font-mono text-emerald-400">{c.code}</code>
                    <button
                      onClick={() => copy(c.code)}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      copy
                    </button>
                    <span className="text-xs text-[var(--text-muted)]">+{c.amount}</span>
                    <div className="flex-1" />
                    {c.used_by ? (
                      <span className="text-xs text-[var(--text-muted)]">
                        использован: {c.used_by_username}
                      </span>
                    ) : (
                      <>
                        <span className="text-xs text-emerald-400">не использован</span>
                        <button
                          onClick={async () => {
                            await api.adminDeleteTokenCode(c.code);
                            loadAll();
                          }}
                          className="text-xs text-red-400 hover:underline"
                        >
                          удалить
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "stats" && stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(stats).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-[var(--bg-tertiary)] p-4">
                  <div className="text-xs text-[var(--text-muted)] uppercase">{k}</div>
                  <div className="text-2xl font-semibold mt-1">{String(v)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-400",
    suspended: "bg-amber-500/15 text-amber-400",
    banned: "bg-red-500/15 text-red-400",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${map[status]}`}>
      {status}
    </span>
  );
}
