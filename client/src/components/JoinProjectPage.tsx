import { useState, useEffect } from "react";
import { api } from "../lib/api";
import type { Project } from "../types";

interface Props {
  token: string;
  onSuccess: (project: Project) => void;
  onLogin: () => void;
  isLoggedIn: boolean;
}

export function JoinProjectPage({ token, onSuccess, onLogin, isLoggedIn }: Props) {
  const [status, setStatus] = useState<"loading" | "success" | "error" | "idle">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!isLoggedIn) return;
    setStatus("loading");
    api.joinProject(token)
      .then((p) => {
        setStatus("success");
        setTimeout(() => onSuccess(p as Project), 1500);
      })
      .catch((e: any) => {
        setStatus("error");
        setMessage(e.message || "Ошибка");
      });
  }, [token, isLoggedIn]);

  return (
    <div className="h-full flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="text-center max-w-sm px-6">
        {!isLoggedIn && (
          <>
            <h1 className="text-[20px] font-semibold mb-3">Присоединиться к проекту</h1>
            <p className="text-[14px] text-[var(--text-muted)] mb-6">
              Войдите в аккаунт, чтобы принять приглашение.
            </p>
            <button
              onClick={onLogin}
              className="px-6 py-2.5 rounded-full bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-90 transition-opacity"
            >
              Войти
            </button>
          </>
        )}
        {isLoggedIn && status === "loading" && (
          <p className="text-[14px] text-[var(--text-muted)]">Применяем приглашение...</p>
        )}
        {isLoggedIn && status === "success" && (
          <p className="text-[14px] text-green-400">Вы успешно присоединились! Перенаправление...</p>
        )}
        {isLoggedIn && status === "error" && (
          <>
            <h1 className="text-[18px] font-semibold text-[var(--danger)] mb-2">Ошибка</h1>
            <p className="text-[13px] text-[var(--text-muted)]">
              {message === "invite expired" && "Ссылка истекла."}
              {message === "invite exhausted" && "Ссылка уже была использована."}
              {message === "invalid invite" && "Ссылка недействительна."}
              {message === "already a member" && "Вы уже являетесь участником этого проекта."}
              {!["invite expired", "invite exhausted", "invalid invite", "already a member"].includes(message) && message}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
