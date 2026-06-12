import { useEffect, useState } from "react";
import {
  GitBranch,
  Check,
  Loader,
  Trash2,
  Link as LinkIcon,
  Download,
} from "lucide-react";
import { api } from "../../lib/api";
import type { GithubStatusDTO } from "../../agentTypes";

export function GithubSettings() {
  const [status, setStatus] = useState<GithubStatusDTO | null>(null);
  const [token, setToken] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState<"save" | "disconnect" | "clone" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setStatus(await api.github());
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const save = async () => {
    if (!token.trim()) return;
    setBusy("save");
    setErr(null);
    setMsg(null);
    try {
      const s = await api.githubSetToken(token.trim());
      setStatus(s);
      setToken("");
      setMsg(`Подключён как ${s.username ?? "—"}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    setErr(null);
    setMsg(null);
    try {
      await api.githubDeleteToken();
      await refresh();
      setMsg("Токен удалён");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const clone = async () => {
    if (!repoUrl.trim()) return;
    setBusy("clone");
    setErr(null);
    setMsg(null);
    try {
      await api.githubClone(repoUrl.trim(), dir.trim() || undefined);
      setMsg("Репозиторий склонирован в воркспейс");
      setRepoUrl("");
      setDir("");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const connected = status?.connected;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <GitBranch size={15} className="text-[var(--text-secondary)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">GitHub</h3>
      </div>

      {connected ? (
        <div className="rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border)] p-3 flex items-center gap-2">
          <Check size={14} className="text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[var(--text-primary)] truncate">
              {status?.username ?? "подключён"}
            </div>
            {status?.connectedAt && (
              <div className="text-[10px] text-[var(--text-muted)]">
                с {new Date(status.connectedAt).toLocaleDateString()}
              </div>
            )}
          </div>
          <button
            onClick={disconnect}
            disabled={busy === "disconnect"}
            className="flex items-center gap-1 text-xs text-red-400 hover:bg-red-500/10 rounded-md px-2 py-1 disabled:opacity-50"
          >
            {busy === "disconnect" ? <Loader size={12} className="spin" /> : <Trash2 size={12} />}
            Отключить
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-xs text-[var(--text-secondary)]">
            Personal Access Token (classic или fine-grained)
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxx"
              className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-[var(--border-focus)]"
            />
            <button
              onClick={save}
              disabled={busy === "save" || !token.trim()}
              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white text-sm rounded-lg px-3 flex items-center gap-1.5"
            >
              {busy === "save" ? <Loader size={13} className="spin" /> : <LinkIcon size={13} />}
              Сохранить
            </button>
          </div>
          <p className="text-[10px] text-[var(--text-muted)]">
            Токен шифруется и используется агентом для git-операций. Нужны права repo.
          </p>
        </div>
      )}

      <div className="border-t border-[var(--border)]" />

      <div className="space-y-2">
        <label className="text-xs text-[var(--text-secondary)]">Клонировать репозиторий</label>
        <input
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/user/repo.git"
          className="w-full bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--border-focus)]"
        />
        <div className="flex gap-2">
          <input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            placeholder="папка (необязательно)"
            className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--border-focus)]"
          />
          <button
            onClick={clone}
            disabled={busy === "clone" || !repoUrl.trim()}
            className="bg-[var(--bg-tertiary)] border border-[var(--border)] hover:border-[var(--border-focus)] disabled:opacity-50 text-[var(--text-primary)] text-sm rounded-lg px-3 flex items-center gap-1.5"
          >
            {busy === "clone" ? <Loader size={13} className="spin" /> : <Download size={13} />}
            Clone
          </button>
        </div>
      </div>

      {msg && <div className="text-xs text-emerald-400">{msg}</div>}
      {err && <div className="text-xs text-red-400">{err}</div>}
    </div>
  );
}
