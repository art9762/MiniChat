import { useState, useCallback, useEffect } from "react";
import { Menu, PanelRight, Shield, User as UserIcon, Settings, Folder } from "lucide-react";
import { Sidebar, type ChatMode } from "./components/Sidebar";
import { ChatWindow } from "./components/ChatWindow";
import { InputBar } from "./components/InputBar";
import { RightPanel } from "./components/RightPanel";
import { AdminPanel } from "./components/AdminPanel";
import { AccountMenu } from "./components/AccountMenu";
import { SettingsModal } from "./components/SettingsModal";
import { WorkspaceChip } from "./components/WorkspaceChip";
import { FilesPanel } from "./components/files/FilesPanel";
import { AgentView } from "./components/agent/AgentView";
import { useConversations } from "./hooks/useConversations";
import { useChat } from "./hooks/useChat";
import { useAgentSessions } from "./hooks/useAgentSessions";
import { useAgent } from "./hooks/useAgent";
import { useAuth } from "./auth/AuthProvider";
import { AuthScreen } from "./auth/AuthScreen";
import type { Settings as ChatSettings, Message } from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_AGENT_MODEL = "claude-sonnet-4-6";

function App() {
  const { user, loading, setBalance } = useAuth();
  const { conversations, active, activeId, setActiveId, create, update, remove } =
    useConversations();
  const [mode, setMode] = useState<ChatMode>("chat");

  const agentSessions = useAgentSessions(mode === "agent");
  const agent = useAgent({ sessionId: mode === "agent" ? agentSessions.activeId : null, onBalance: setBalance });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingAgentPrompt, setPendingAgentPrompt] = useState<string | null>(null);
  const [settings, setSettings] = useState<ChatSettings>(() => {
    try {
      return JSON.parse(localStorage.getItem("minichat_settings") || "null") ?? {
        temperature: 0.7,
        systemPrompt: "",
      };
    } catch {
      return { temperature: 0.7, systemPrompt: "" };
    }
  });

  const handleSettingsChange = (s: ChatSettings) => {
    setSettings(s);
    localStorage.setItem("minichat_settings", JSON.stringify(s));
  };

  const model = active?.model || DEFAULT_MODEL;

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

  const handleSend = (text: string) => {
    if (!activeId) create(model);
    send(text);
  };

  const handleModelChange = (m: string) => {
    if (activeId) update(activeId, { model: m });
  };

  const handleAgentSend = async (text: string) => {
    if (agentSessions.activeId) {
      agent.send(text, DEFAULT_AGENT_MODEL);
      return;
    }
    // No session yet: create one, then send once it's the active session.
    // useAgent queues the prompt internally and flushes when its socket opens.
    setPendingAgentPrompt(text);
    await agentSessions.create();
  };

  // Flush a prompt that was issued before a session existed, once the agent
  // hook has switched to the new active session.
  useEffect(() => {
    if (pendingAgentPrompt && agentSessions.activeId) {
      agent.send(pendingAgentPrompt, DEFAULT_AGENT_MODEL);
      setPendingAgentPrompt(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAgentPrompt, agentSessions.activeId]);

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
      <div className="h-full flex items-center justify-center bg-[var(--bg-primary)] text-red-400">
        Аккаунт заблокирован.
      </div>
    );
  }

  const isAgent = mode === "agent";
  const headerTitle = isAgent
    ? agentSessions.sessions.find((s) => s.id === agentSessions.activeId)?.title || "Agent"
    : active?.title || "MiniChat";
  const currentModelName = isAgent
    ? DEFAULT_AGENT_MODEL.replace("claude-", "").replace(/-/g, " ")
    : model.includes("claude")
    ? model.replace("claude-", "").replace(/-/g, " ")
    : model;

  return (
    <div className="h-full flex bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <Sidebar
        mode={mode}
        onModeChange={setMode}
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={() => create(model)}
        onDelete={remove}
        sessions={agentSessions.sessions}
        agentActiveId={agentSessions.activeId}
        agentLoading={agentSessions.loading}
        onSelectSession={agentSessions.setActiveId}
        onCreateSession={() => void agentSessions.create()}
        onDeleteSession={(id) => void agentSessions.remove(id)}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-2 px-4 h-11 border-b border-[var(--border)] shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-1.5 hover:bg-[var(--bg-hover)] rounded-md transition-colors"
          >
            <Menu size={16} />
          </button>
          <span className="text-xs font-medium text-[var(--text-secondary)] truncate">
            {headerTitle}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] font-mono">
            {currentModelName}
          </span>
          <div className="flex-1" />
          {((isAgent && agent.isRunning) || (!isAgent && isStreaming)) && (
            <span className="text-[10px] text-[var(--accent)] animate-pulse font-medium">
              {isAgent ? "Running..." : "Streaming..."}
            </span>
          )}

          <div className="flex items-center gap-1">
            {isAgent && <WorkspaceChip />}
            <span
              className="text-xs tabular-nums text-[var(--text-muted)] px-2 py-1 rounded-md bg-[var(--bg-tertiary)]"
              title="Баланс токенов"
            >
              ⚡ {user.token_balance.toLocaleString()}
            </span>
            {isAgent && (
              <button
                onClick={() => setFilesOpen((o) => !o)}
                className={`p-2 hover:bg-[var(--bg-hover)] rounded-lg transition-colors ${
                  filesOpen ? "text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
                title="Файлы воркспейса"
              >
                <Folder size={18} />
              </button>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-2 hover:bg-[var(--bg-hover)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="Настройки"
            >
              <Settings size={18} />
            </button>
            {user.role === "admin" && (
              <button
                onClick={() => setAdminOpen(true)}
                className="p-2 hover:bg-[var(--bg-hover)] rounded-lg text-[var(--text-muted)] hover:text-amber-400 transition-colors"
                title="Админ-панель"
              >
                <Shield size={18} />
              </button>
            )}
            <button
              onClick={() => setAccountOpen(true)}
              className="p-2 hover:bg-[var(--bg-hover)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="Аккаунт"
            >
              <UserIcon size={18} />
            </button>
            {!isAgent && (
              <button
                onClick={() => setRightPanelOpen(!rightPanelOpen)}
                className="hidden lg:flex p-2 hover:bg-[var(--bg-hover)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Toggle settings panel"
              >
                <PanelRight size={18} />
              </button>
            )}
          </div>
        </header>

        {user.status === "suspended" && (
          <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-400 text-xs px-4 py-2">
            Аккаунт временно приостановлен. {isAgent ? "Агент" : "Чат"} недоступен.
          </div>
        )}

        {isAgent ? (
          <AgentView
            items={agent.items}
            isRunning={agent.isRunning}
            connected={agent.connected}
            error={agent.error}
            onSend={handleAgentSend}
            onCancel={agent.cancel}
            disabled={user.status !== "active"}
          />
        ) : (
          <>
            <ChatWindow messages={active?.messages || []} onSuggestionClick={handleSend} />
            <InputBar
              onSend={handleSend}
              isStreaming={isStreaming}
              disabled={user.status !== "active"}
            />
          </>
        )}
      </main>

      {isAgent && filesOpen && <FilesPanel onClose={() => setFilesOpen(false)} />}
      {!isAgent && rightPanelOpen && (
        <RightPanel
          model={model}
          onModelChange={handleModelChange}
          settings={settings}
          onSettingsChange={handleSettingsChange}
        />
      )}

      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
      {accountOpen && <AccountMenu onClose={() => setAccountOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default App;
