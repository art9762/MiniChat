import { useState, useCallback } from "react";
import { Menu, PanelRightClose, PanelRightOpen, Shield, User as UserIcon, Zap } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { ChatWindow } from "./components/ChatWindow";
import { InputBar } from "./components/InputBar";
import { RightPanel } from "./components/RightPanel";
import { AdminPanel } from "./components/AdminPanel";
import { AccountMenu } from "./components/AccountMenu";
import { ProjectView } from "./components/ProjectView";
import { NewProjectModal } from "./components/NewProjectModal";
import { JoinProjectPage } from "./components/JoinProjectPage";
import { useConversations } from "./hooks/useConversations";
import { useChat } from "./hooks/useChat";
import { useAuth } from "./auth/AuthProvider";
import { AuthScreen } from "./auth/AuthScreen";
import { useProjects } from "./hooks/useProjects";
import type { Settings, Message, Project } from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-6";

const MODEL_NAMES: Record<string, string> = {
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "claude-sonnet-4-6-1m": "Claude Sonnet 4.6 (1M)",
  "claude-opus-4-6-1m": "Claude Opus 4.6 (1M)",
  "claude-opus-4-7-1m": "Claude Opus 4.7 (1M)",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.2": "GPT-5.2",
  "gpt-5-mini": "GPT-5 Mini",
};

// Detect /projects/join/:token route
function getJoinToken(): string | null {
  const m = window.location.pathname.match(/^\/projects\/join\/([^/]+)$/);
  return m ? m[1] : null;
}

function App() {
  const { user, loading, setBalance } = useAuth();
  const { conversations, active, activeId, setActiveId, create, update, remove } =
    useConversations();
  const { projects, create: createProject, refresh: refreshProjects } = useProjects();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 1024px)").matches;
  });
  const [adminOpen, setAdminOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Join token handling
  const [joinToken] = useState<string | null>(getJoinToken);

  const [settings, setSettings] = useState<Settings>(() => {
    try {
      return JSON.parse(localStorage.getItem("minichat_settings") || "null") ?? {
        temperature: 0.7,
        systemPrompt: "",
      };
    } catch {
      return { temperature: 0.7, systemPrompt: "" };
    }
  });

  const handleSettingsChange = (s: Settings) => {
    setSettings(s);
    localStorage.setItem("minichat_settings", JSON.stringify(s));
  };

  const model = active?.model || DEFAULT_MODEL;
  const modelName = MODEL_NAMES[model] || model;

  const handleMessagesUpdate = useCallback(
    (msgs: Message[]) => {
      if (!activeId) return;
      const title =
        msgs.find((m) => m.role === "user")?.content.slice(0, 40) || "New Chat";
      update(activeId, { messages: msgs, title });
    },
    [activeId, update]
  );

  const { send, isStreaming } = useChat(
    active?.messages || [],
    model,
    settings,
    handleMessagesUpdate,
    setBalance
  );

  const handleSend = (text: string, attachments?: import('./types').ChatAttachment[]) => {
    let chatId = activeId;
    if (!chatId) {
      chatId = create(model, activeProjectId ?? undefined);
    }
    send(text, chatId, attachments);
  };

  const handleModelChange = (m: string) => {
    if (activeId) update(activeId, { model: m });
  };

  const handleCreateProjectChat = useCallback((projectId: string) => {
    const id = create(model, projectId);
    setActiveProjectId(null); // go to chat view
    setActiveId(id);
  }, [create, model, setActiveId]);

  const handleOpenChat = useCallback((chatId: string) => {
    setActiveId(chatId);
    setActiveProjectId(null);
  }, [setActiveId]);

  const handleSelectProject = useCallback((id: string) => {
    setActiveProjectId(id);
    setActiveId(null as any);
    setSidebarOpen(false);
  }, [setActiveId]);

  const handleJoinSuccess = useCallback((project: Project) => {
    refreshProjects();
    setActiveProjectId(project.id);
    window.history.replaceState(null, "", "/");
  }, [refreshProjects]);

  // Build projectChats map for sidebar
  const projectChats: Record<string, typeof conversations> = {};
  for (const p of projects) {
    projectChats[p.id] = conversations.filter((c) => c.project_id === p.id);
  }

  // Active chat's project badge
  const activeChatProject = active?.project_id
    ? projects.find((p) => p.id === active.project_id)
    : null;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-muted)] text-sm">
        Загрузка...
      </div>
    );
  }
  if (!user) return <AuthScreen />;

  if (user.status === "banned") {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--bg-primary)] text-[var(--danger)]">
        Аккаунт заблокирован.
      </div>
    );
  }

  // Join page
  if (joinToken) {
    return (
      <JoinProjectPage
        token={joinToken}
        isLoggedIn={!!user}
        onSuccess={handleJoinSuccess}
        onLogin={() => {}}
      />
    );
  }

  return (
    <div className="h-full flex bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id);
          setActiveProjectId(null);
          setSidebarOpen(false);
        }}
        onCreate={(projectId) => {
          create(model, projectId);
          setActiveProjectId(null);
          setSidebarOpen(false);
        }}
        onDelete={remove}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
        onCreateProject={() => setNewProjectOpen(true)}
        projectChats={projectChats}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 h-[56px] sm:h-[60px] shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden btn-icon"
            aria-label="Меню"
          >
            <Menu size={18} />
          </button>
          <div className="flex flex-col min-w-0 flex-1 md:flex-none">
            <div className="flex items-center gap-2">
              <span className="text-[14px] sm:text-[15px] font-medium text-[var(--text-primary)] truncate leading-tight">
                {activeProjectId
                  ? projects.find((p) => p.id === activeProjectId)?.name || "Проект"
                  : active?.title || "New chat"}
              </span>
              {activeChatProject && !activeProjectId && (
                <button
                  onClick={() => setActiveProjectId(activeChatProject.id)}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] hover:opacity-80 transition-opacity shrink-0"
                >
                  {activeChatProject.name}
                </button>
              )}
            </div>
            <span className="text-[11px] text-[var(--text-muted)] truncate">
              {activeProjectId ? "Проект" : modelName}
            </span>
          </div>

          <div className="hidden md:block flex-1" />

          {isStreaming && !activeProjectId && (
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[12px] text-[var(--accent)] mr-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              Streaming
            </span>
          )}

          {/* Balance pill */}
          <div
            className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-[12px] tabular-nums text-[var(--text-secondary)] px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-[var(--bg-tertiary)] shrink-0"
            title="Баланс токенов"
          >
            <Zap size={12} className="text-[var(--warning)]" />
            <span className="balance-full">{user.token_balance.toLocaleString()}</span>
            <span className="balance-compact">{formatCompact(user.token_balance)}</span>
          </div>

          {user.role === "admin" && (
            <button
              onClick={() => setAdminOpen(true)}
              className="btn-icon"
              title="Админ-панель"
              aria-label="Админ-панель"
            >
              <Shield size={18} />
            </button>
          )}
          <button
            onClick={() => setAccountOpen(true)}
            className="btn-icon"
            title="Аккаунт"
            aria-label="Аккаунт"
          >
            <UserIcon size={18} />
          </button>
          {!activeProjectId && (
            <button
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
              className="btn-icon"
              title="Настройки"
              aria-label="Настройки"
            >
              {rightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </button>
          )}
        </header>

        {user.status === "suspended" && (
          <div className="bg-[#fdd663]/10 border-b border-[#fdd663]/30 text-[var(--warning)] text-[13px] px-5 py-2.5">
            Аккаунт временно приостановлен. Чат недоступен.
          </div>
        )}

        {activeProjectId ? (
          <ProjectView
            projectId={activeProjectId}
            currentUser={user}
            conversations={conversations}
            onOpenChat={handleOpenChat}
            onCreateChat={handleCreateProjectChat}
            onBack={() => setActiveProjectId(null)}
          />
        ) : (
          <>
            <ChatWindow
              messages={active?.messages || []}
              isStreaming={isStreaming}
              onSuggestionClick={(text) => handleSend(text)}
            />
            <InputBar
              onSend={handleSend}
              isStreaming={isStreaming}
              disabled={user.status !== "active"}
              modelName={modelName}
              chatId={activeId}
            />
          </>
        )}
      </main>

      {!activeProjectId && (
        <RightPanel
          model={model}
          onModelChange={handleModelChange}
          settings={settings}
          onSettingsChange={handleSettingsChange}
          isOpen={rightPanelOpen}
          onClose={() => setRightPanelOpen(false)}
        />
      )}

      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
      {accountOpen && <AccountMenu onClose={() => setAccountOpen(false)} />}
      {newProjectOpen && (
        <NewProjectModal
          onClose={() => setNewProjectOpen(false)}
          onCreate={async (name, description) => {
            const p = await createProject(name, description);
            setActiveProjectId(p.id);
          }}
        />
      )}
    </div>
  );
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "k";
  return n.toString();
}

export default App;
