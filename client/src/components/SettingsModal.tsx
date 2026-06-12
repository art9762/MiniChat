import { X } from "lucide-react";
import { GithubSettings } from "./github/GithubSettings";

interface Props {
  onClose: () => void;
}

// Settings modal — currently hosts the GitHub integration. Designed to grow
// extra sections (tabs) later.
export function SettingsModal({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[var(--bg-elevated)] border border-[var(--border)] rounded-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold">Настройки</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X size={15} />
          </button>
        </header>
        <div className="p-4 overflow-y-auto max-h-[80vh]">
          <GithubSettings />
        </div>
      </div>
    </div>
  );
}
