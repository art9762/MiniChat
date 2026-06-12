import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { api } from "../lib/api";

interface Props {
  onClose: () => void;
}

export function AccountMenu({ onClose }: Props) {
  const { user, logout, setBalance } = useAuth();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!user) return null;

  const redeem = async () => {
    setErr(null);
    setMsg(null);
    try {
      const r = await api.redeem(code.trim());
      setBalance(r.balance);
      setMsg(`+${r.added} токенов. Баланс: ${r.balance}`);
      setCode("");
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center sm:justify-end p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm sm:w-80 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl p-4 mt-12 sm:mr-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div className="text-sm font-semibold">{user.username}</div>
          <div className="text-xs text-[var(--text-muted)]">
            {user.role === "admin" ? "администратор" : "пользователь"} ·{" "}
            <span
              className={
                user.status === "active"
                  ? "text-emerald-400"
                  : user.status === "suspended"
                  ? "text-amber-400"
                  : "text-red-400"
              }
            >
              {user.status}
            </span>
          </div>
        </div>

        <div className="rounded-xl bg-[var(--bg-tertiary)] p-3">
          <div className="text-xs text-[var(--text-muted)]">Баланс токенов</div>
          <div className="text-2xl font-semibold tabular-nums">{user.token_balance.toLocaleString()}</div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-[var(--text-secondary)]">Активировать код</div>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="TKN-XXXX-XXXX"
              className="flex-1 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={redeem}
              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg px-3"
            >
              OK
            </button>
          </div>
          {msg && <div className="text-xs text-emerald-400">{msg}</div>}
          {err && <div className="text-xs text-red-400">{err}</div>}
        </div>

        <button
          onClick={async () => {
            await logout();
            onClose();
          }}
          className="w-full text-sm text-red-400 hover:bg-red-500/10 rounded-lg py-2"
        >
          Выйти
        </button>
      </div>
    </div>
  );
}
