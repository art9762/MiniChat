import { Plus, Trash2, MessageSquare, Sparkles } from "lucide-react";
import type { Conversation } from "../types";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  isOpen,
  onToggle,
}: Props) {
  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={onToggle}
        />
      )}
      <aside
        className={`fixed md:static z-50 top-0 left-0 h-full w-64 bg-[var(--bg-sidebar)] flex flex-col transition-transform duration-200 ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Brand */}
        <div className="px-4 pt-4 pb-3 flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#8ab4f8] to-[#669df6] flex items-center justify-center">
            <Sparkles size={14} className="text-[#1f1f1f]" strokeWidth={2.5} />
          </div>
          <span className="text-[15px] font-medium text-[var(--text-primary)]">MiniChat</span>
        </div>

        {/* New chat */}
        <div className="px-3 pb-2">
          <button
            onClick={onCreate}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-full bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[13px] font-medium text-[var(--text-primary)] transition-colors"
          >
            <Plus size={16} strokeWidth={2.2} />
            New chat
          </button>
        </div>

        {/* History label */}
        <div className="px-5 pt-3 pb-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
            Recent
          </span>
        </div>

        {/* Conversations */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {conversations.length === 0 && (
            <p className="text-[12px] text-[var(--text-faint)] text-center mt-6 px-4">
              No conversations yet
            </p>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`group flex items-center gap-2.5 px-3 py-2 rounded-full cursor-pointer text-[13px] transition-colors ${
                conv.id === activeId
                  ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <MessageSquare size={14} className="shrink-0 opacity-70" />
              <span className="flex-1 truncate">{conv.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conv.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-[var(--danger)] transition-opacity p-1"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 text-[11px] text-[var(--text-faint)]">
          MiniChat · v1.0
        </div>
      </aside>
    </>
  );
}
