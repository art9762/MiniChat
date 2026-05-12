import { MessageSquarePlus, Trash2, MessageSquare } from "lucide-react";
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
          className="fixed inset-0 bg-black/40 z-40 md:hidden backdrop-blur-sm"
          onClick={onToggle}
        />
      )}
      <aside
        className={`fixed md:static z-50 top-0 left-0 h-full w-60 bg-[var(--bg-sidebar)] border-r border-[var(--border)] flex flex-col transition-transform duration-200 ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="p-3">
          <button
            onClick={onCreate}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors"
          >
            <MessageSquarePlus size={16} />
            New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {conversations.length === 0 && (
            <p className="text-xs text-[var(--text-muted)] text-center mt-8 px-4">
              No conversations yet
            </p>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`group flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer text-sm transition-colors ${
                conv.id === activeId
                  ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <MessageSquare size={14} className="shrink-0 opacity-50" />
              <span className="flex-1 truncate">{conv.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conv.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity p-0.5"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
