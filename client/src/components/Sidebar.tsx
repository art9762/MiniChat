import { Plus, Trash2, MessageSquare } from "lucide-react";
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
        className={`fixed md:static z-50 top-0 left-0 h-full w-56 bg-[var(--bg-sidebar)] border-r border-[var(--border)] flex flex-col transition-transform duration-200 ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="p-2.5 border-b border-[var(--border)]">
          <button
            onClick={onCreate}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] hover:border-[var(--border-focus)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
          >
            <Plus size={13} strokeWidth={2.5} />
            New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1.5 px-1.5 space-y-px">
          {conversations.length === 0 && (
            <p className="text-[11px] text-[var(--text-muted)] text-center mt-10 px-4">
              No conversations
            </p>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer text-xs transition-colors ${
                conv.id === activeId
                  ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <MessageSquare size={12} className="shrink-0 opacity-40" />
              <span className="flex-1 truncate">{conv.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conv.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity p-0.5"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
        <div className="p-2.5 border-t border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-muted)] text-center">MiniChat v1.0</div>
        </div>
      </aside>
    </>
  );
}
