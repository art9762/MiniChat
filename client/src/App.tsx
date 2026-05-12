import { useState, useCallback } from "react";
import { Menu, PanelRight, Shield, User as UserIcon } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { ChatWindow } from "./components/ChatWindow";
import { InputBar } from "./components/InputBar";
import { RightPanel } from "./components/RightPanel";
import { AdminPanel } from "./components/AdminPanel";
import { AccountMenu } from "./components/AccountMenu";
import { useConversations } from "./hooks/useConversations";
import { useChat } from "./hooks/useChat";
import { useAuth } from "./auth/AuthProvider";
import { AuthScreen } from "./auth/AuthScreen";
import type { Settings, Message } from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-6";

function App() {
  const { user, loading, setBalance } = useAuth();
  const { conversations, active, activeId, setActiveId, create, update, remove } =
    useConversations();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [adminOpen, setAdminOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
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
    if (!activeId) {
      create(model);
    }
    send(text);
  };

  const handleModelChange = (m: string) => {
    if (activeId) update(activeId, { model: m });
  };

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

  const currentModelName = model.includes("claude")
    ? model.replace("claude-", "").replace(/-/g, " ")
    : model;

  return (
    <div className="h-full flex bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={() => create(model)}
        onDelete={remove}
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
            {active?.title || "MiniChat"}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] font-mono">
            {currentModelName}
          </span>
          <div className="flex-1" />
          {isStreaming && (
            <span className="text-[10px] text-[var(--accent)] animate-pulse font-medium">
              Streaming...
            </span>
          )}

          <div className="flex items-center gap-1">
            <span
              className="text-xs tabular-nums text-[var(--text-muted)] px-2 py-1 rounded-md bg-[var(--bg-tertiary)]"
              title="Баланс токенов"
            >
              ⚡ {user.token_balance.toLocaleString()}
            </span>
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
            <button
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
              className="hidden lg:flex p-2 hover:bg-[var(--bg-hover)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="Toggle settings panel"
            >
              <PanelRight size={18} />
            </button>
          </div>
        </header>

        {user.status === "suspended" && (
          <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-400 text-xs px-4 py-2">
            Аккаунт временно приостановлен. Чат недоступен.
          </div>
        )}

        <ChatWindow messages={active?.messages || []} onSuggestionClick={handleSend} />
        <InputBar
          onSend={handleSend}
          isStreaming={isStreaming}
          disabled={user.status !== "active"}
        />
      </main>
      {rightPanelOpen && (
        <RightPanel
          model={model}
          onModelChange={handleModelChange}
          settings={settings}
          onSettingsChange={handleSettingsChange}
        />
      )}

      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
      {accountOpen && <AccountMenu onClose={() => setAccountOpen(false)} />}
    </div>
  );
}

export default App;
