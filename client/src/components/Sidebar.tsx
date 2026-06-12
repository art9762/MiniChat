import { Plus, Trash2, MessageSquare, Bot, Loader } from "lucide-react";
import type { Conversation } from "../types";
import type { AgentSessionDTO } from "../agentTypes";

export type ChatMode = "chat" | "agent";

interface Props {
  mode: ChatMode;
  onModeChange: (m: ChatMode) => void;

  // chat mode
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;

  // agent mode
  sessions: AgentSessionDTO[];
  agentActiveId: string | null;
  agentLoading: boolean;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;

  isOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({
  mode,
  onModeChange,
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  sessions,
  agentActiveId,
  agentLoading,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  isOpen,
  onToggle,
}: Props) {
  const isAgent = mode === "agent";

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 md:hidden" onClick={onToggle} />
      )}
      <aside
        className={`fixed md:static z-50 top-0 left-0 h-full w-60 bg-[var(--bg-sidebar)] border-r border-[var(--border)] flex flex-col transition-transform duration-200 ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Mode toggle */}
        <div className="p-2.5 border-b border-[var(--border)]">
          <div className="flex gap-1 p-0.5 rounded-lg bg-[var(--bg-tertiary)] mb-2.5">
            <button
              onClick={() => onModeChange("chat")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                !isAgent
                  ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <MessageSquare size={13} /> Chat
            </button>
            <button
              onClick={() => onModeChange("agent")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isAgent
                  ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <Bot size={13} /> Agent
            </button>
          </div>
          <button
            onClick={isAgent ? onCreateSession : onCreate}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] hover:border-[var(--border-focus)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
          >
            <Plus size={13} strokeWidth={2.5} />
            {isAgent ? "New session" : "New chat"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1.5 px-1.5 space-y-px">
          {isAgent ? (
            <>
              {agentLoading && sessions.length === 0 && (
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--text-muted)] mt-10">
                  <Loader size={12} className="spin" /> загрузка…
                </div>
              )}
              {!agentLoading && sessions.length === 0 && (
                <p className="text-[11px] text-[var(--text-muted)] text-center mt-10 px-4">
                  Нет сессий агента
                </p>
              )}
              {sessions.map((s) => (
                <SidebarRow
                  key={s.id}
                  icon={
                    s.status === "running" ? (
                      <Loader size={12} className="spin text-[var(--accent)]" />
                    ) : (
                      <Bot size={12} className="opacity-40" />
                    )
                  }
                  title={s.title || "Сессия"}
                  active={s.id === agentActiveId}
                  onSelect={() => onSelectSession(s.id)}
                  onDelete={() => onDeleteSession(s.id)}
                />
              ))}
            </>
          ) : (
            <>
              {conversations.length === 0 && (
                <p className="text-[11px] text-[var(--text-muted)] text-center mt-10 px-4">
                  No conversations
                </p>
              )}
              {conversations.map((conv) => (
                <SidebarRow
                  key={conv.id}
                  icon={<MessageSquare size={12} className="opacity-40" />}
                  title={conv.title}
                  active={conv.id === activeId}
                  onSelect={() => onSelect(conv.id)}
                  onDelete={() => onDelete(conv.id)}
                />
              ))}
            </>
          )}
        </div>
        <div className="p-2.5 border-t border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-muted)] text-center">MiniChat</div>
        </div>
      </aside>
    </>
  );
}

function SidebarRow({
  icon,
  title,
  active,
  onSelect,
  onDelete,
}: {
  icon: React.ReactNode;
  title: string;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer text-xs transition-colors ${
        active
          ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate">{title}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity p-0.5"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}
