import { useState } from "react";
import { Plus, Trash2, MessageSquare, Bot, Loader, Sparkles, ChevronDown, ChevronRight, FolderOpen, Folder } from "lucide-react";
import type { Conversation } from "../types";
import type { Project } from "../types";
import type { AgentSessionDTO } from "../agentTypes";

export type ChatMode = "chat" | "agent";

interface Props {
  mode: ChatMode;
  onModeChange: (m: ChatMode) => void;

  // chat mode
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (projectId?: string) => void;
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
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  projectChats: Record<string, Conversation[]>; // projectId -> chats
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
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  projectChats,
}: Props) {
  const isAgent = mode === "agent";
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Conversations not in any project
  const freeConversations = conversations.filter((c) => !(c as any).project_id);

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 md:hidden" onClick={onToggle} />
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

        {/* Mode toggle */}
        <div className="px-3 pb-2">
          <div className="flex gap-1 p-0.5 rounded-full bg-[var(--bg-tertiary)]">
            <button
              onClick={() => onModeChange("chat")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                !isAgent
                  ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <MessageSquare size={13} /> Chat
            </button>
            <button
              onClick={() => onModeChange("agent")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                isAgent
                  ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <Bot size={13} /> Agent
            </button>
          </div>
        </div>

        {/* New chat / session */}
        <div className="px-3 pb-2">
          <button
            onClick={isAgent ? onCreateSession : () => onCreate()}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-full bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[13px] font-medium text-[var(--text-primary)] transition-colors"
          >
            <Plus size={16} strokeWidth={2.2} />
            {isAgent ? "New session" : "New chat"}
          </button>
        </div>

        {isAgent ? (
          /* Agent sessions */
          <div className="flex-1 overflow-y-auto pb-2 px-2 space-y-0.5">
            {agentLoading && sessions.length === 0 && (
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--text-faint)] mt-10">
                <Loader size={12} className="spin" /> загрузка…
              </div>
            )}
            {!agentLoading && sessions.length === 0 && (
              <p className="text-[12px] text-[var(--text-faint)] text-center mt-6 px-4">
                Нет сессий агента
              </p>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => onSelectSession(s.id)}
                className={`group flex items-center gap-2.5 px-3 py-2 rounded-full cursor-pointer text-[13px] transition-colors ${
                  s.id === agentActiveId
                    ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <span className="shrink-0">
                  {s.status === "running" ? (
                    <Loader size={13} className="spin text-[var(--accent)]" />
                  ) : (
                    <Bot size={13} className="opacity-70" />
                  )}
                </span>
                <span className="flex-1 truncate">{s.title || "Сессия"}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-[var(--danger)] transition-opacity p-1"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pb-2">
            {/* Projects section */}
            {projects.length > 0 && (
              <div className="mb-2">
                <div className="flex items-center justify-between px-5 pt-3 pb-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
                    Проекты
                  </span>
                  <button
                    onClick={onCreateProject}
                    className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
                    title="Новый проект"
                  >
                    <Plus size={12} strokeWidth={2.5} />
                  </button>
                </div>
                <div className="px-2 space-y-0.5">
                  {projects.map((project) => {
                    const isExpanded = expandedProjects.has(project.id);
                    const isActive = project.id === activeProjectId;
                    const pChats = projectChats[project.id] || [];
                    return (
                      <div key={project.id}>
                        <div
                          className={`flex items-center gap-2 px-3 py-2 rounded-full cursor-pointer text-[13px] transition-colors ${
                            isActive
                              ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                          }`}
                        >
                          <button
                            onClick={() => toggleProject(project.id)}
                            className="shrink-0 opacity-60 hover:opacity-100"
                          >
                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                          <span
                            className="flex-1 truncate flex items-center gap-1.5"
                            onClick={() => onSelectProject(project.id)}
                          >
                            {isActive ? <FolderOpen size={13} className="shrink-0" /> : <Folder size={13} className="shrink-0 opacity-70" />}
                            {project.name}
                          </span>
                          <span className="text-[10px] opacity-50 shrink-0">
                            {project.role === "owner" ? "✦" : ""}
                          </span>
                        </div>
                        {isExpanded && (
                          <div className="ml-5 pl-2 border-l border-[var(--border)] space-y-0.5 mt-0.5 mb-1">
                            {pChats.length === 0 && (
                              <p className="text-[11px] text-[var(--text-faint)] px-2 py-1">Нет чатов</p>
                            )}
                            {pChats.map((chat) => (
                              <div
                                key={chat.id}
                                onClick={() => onSelect(chat.id)}
                                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[12px] transition-colors ${
                                  chat.id === activeId
                                    ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                }`}
                              >
                                <MessageSquare size={11} className="shrink-0 opacity-60" />
                                <span className="truncate">{chat.title || "Новый чат"}</span>
                              </div>
                            ))}
                            <button
                              onClick={() => onCreate(project.id)}
                              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors w-full"
                            >
                              <Plus size={10} strokeWidth={2.5} /> Новый чат
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button
                    onClick={onCreateProject}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors w-full"
                  >
                    <Plus size={12} strokeWidth={2.3} /> Новый проект
                  </button>
                </div>
              </div>
            )}

            {/* No projects yet prompt */}
            {projects.length === 0 && (
              <div className="px-2 mb-2">
                <div className="px-5 pt-3 pb-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
                    Проекты
                  </span>
                </div>
                <button
                  onClick={onCreateProject}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors w-full"
                >
                  <Plus size={12} strokeWidth={2.3} /> Новый проект
                </button>
              </div>
            )}

            {/* History label */}
            <div className="px-5 pt-2 pb-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
                Recent
              </span>
            </div>

            {/* Free conversations */}
            <div className="px-2 space-y-0.5">
              {freeConversations.length === 0 && conversations.length === 0 && (
                <p className="text-[12px] text-[var(--text-faint)] text-center mt-6 px-4">
                  No conversations yet
                </p>
              )}
              {freeConversations.map((conv) => (
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
          </div>
        )}

        <div className="px-5 py-3 text-[11px] text-[var(--text-faint)]">
          MiniChat · v1.0
        </div>
      </aside>
    </>
  );
}
