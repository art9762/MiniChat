import { useState } from "react";
import { useAuth } from "./AuthProvider";

export function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [step, setStep] = useState<"invite" | "creds">("invite");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(username, password);
      } else {
        if (step === "invite") {
          if (!inviteCode.trim()) throw new Error("введи код приглашения");
          setStep("creds");
        } else {
          await register(username, password, inviteCode.trim());
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)] p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold">MiniChat</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {mode === "login" ? "Вход в аккаунт" : "Регистрация по приглашению"}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === "register" && step === "invite" && (
            <input
              autoFocus
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="INV-XXXX-XXXX"
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500/50"
            />
          )}
          {(mode === "login" || step === "creds") && (
            <>
              <input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Имя пользователя"
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500/50"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Пароль"
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500/50"
              />
            </>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl px-4 py-3 text-sm font-medium transition-colors"
          >
            {busy
              ? "..."
              : mode === "login"
              ? "Войти"
              : step === "invite"
              ? "Далее"
              : "Создать аккаунт"}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-[var(--text-muted)]">
          {mode === "login" ? (
            <>
              Нет аккаунта?{" "}
              <button
                onClick={() => {
                  setMode("register");
                  setStep("invite");
                  setError(null);
                }}
                className="text-blue-400 hover:underline"
              >
                Регистрация
              </button>
            </>
          ) : (
            <>
              Уже есть?{" "}
              <button
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
                className="text-blue-400 hover:underline"
              >
                Войти
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
