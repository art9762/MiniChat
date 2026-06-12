import { useEffect, useRef, useState } from "react";
import { Server, Play, Square, RotateCcw, Loader, ChevronDown } from "lucide-react";
import { api } from "../lib/api";
import type { WorkspaceDTO } from "../agentTypes";

const STATUS_META: Record<
  WorkspaceDTO["status"],
  { label: string; dot: string }
> = {
  none: { label: "нет", dot: "bg-[var(--text-muted)]" },
  stopped: { label: "остановлен", dot: "bg-[var(--text-muted)]" },
  starting: { label: "запуск…", dot: "bg-amber-400 animate-pulse" },
  running: { label: "работает", dot: "bg-emerald-500" },
  error: { label: "ошибка", dot: "bg-red-500" },
};

interface Props {
  onChange?: (ws: WorkspaceDTO) => void;
}

export function WorkspaceChip({ onChange }: Props) {
  const [ws, setWs] = useState<WorkspaceDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try {
      const data = await api.workspace();
      setWs(data);
      onChange?.(data);
    } catch {
      /* not authed / no workspace yet */
    }
  };

  useEffect(() => {
    refresh();
    // Poll while transitioning states.
    const t = setInterval(() => {
      setWs((cur) => {
        if (cur && (cur.status === "starting" || cur.status === "running")) refresh();
        return cur;
      });
    }, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmReset(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
      setMenuOpen(false);
      setConfirmReset(false);
    }
  };

  const status = ws?.status ?? "none";
  const meta = STATUS_META[status];
  const isUp = status === "running" || status === "starting";

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] hover:border-[var(--border-focus)] text-[11px] text-[var(--text-secondary)] transition-colors"
        title="Воркспейс"
      >
        <Server size={12} />
        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
        <span className="hidden sm:inline">{meta.label}</span>
        <ChevronDown size={11} className="opacity-60" />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-xl z-50 p-1.5 text-xs">
          <div className="px-2 py-1.5 text-[10px] text-[var(--text-muted)]">
            Статус: <span className="text-[var(--text-secondary)]">{meta.label}</span>
            {ws && (
              <div className="mt-0.5">
                Диск: {(ws.diskUsedBytes / 1e9).toFixed(2)} ГБ
                {ws.diskQuotaBytes != null
                  ? ` / ${(ws.diskQuotaBytes / 1e9).toFixed(0)} ГБ`
                  : " / ∞"}
              </div>
            )}
          </div>
          <div className="border-t border-[var(--border)] my-1" />

          {isUp ? (
            <button
              disabled={busy}
              onClick={() => act(api.workspaceStop)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              {busy ? <Loader size={12} className="spin" /> : <Square size={12} />}
              Остановить
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => act(api.workspaceStart)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              {busy ? <Loader size={12} className="spin" /> : <Play size={12} />}
              Запустить
            </button>
          )}

          {confirmReset ? (
            <div className="px-2 py-1.5">
              <p className="text-[10px] text-red-400 mb-1.5">
                Удалить все файлы воркспейса? Действие необратимо.
              </p>
              <div className="flex gap-1.5">
                <button
                  disabled={busy}
                  onClick={() => act(api.workspaceReset)}
                  className="flex-1 px-2 py-1 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-50"
                >
                  Удалить
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="flex-1 px-2 py-1 rounded bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-red-500/10 text-red-400/80 hover:text-red-400"
            >
              <RotateCcw size={12} />
              Сбросить воркспейс
            </button>
          )}
        </div>
      )}
    </div>
  );
}
