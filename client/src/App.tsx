import { useState, useCallback } from "react";
import { Menu, PanelRightClose, PanelRightOpen, Shield, User as UserIcon, Zap } from "lucide-react";
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
      <div className="h-full flex items-center justify-center bg-[var(--bg-primary)] text-[var(--danger)]">
        Аккаунт заблокирован.
      </div>
    );
  }

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
        <header className="flex items-center gap-2 px-4 h-[60px] shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden btn-icon"
          >
            <Menu size={18} />
          </button>
          <div className="flex flex-col min-w-0">
            <span className="text-[15px] font-medium text-[var(--text-primary)] truncate leading-tight">
              {active?.title || "New chat"}
            </span>
            <span className="text-[11px] text-[var(--text-muted)] truncate">
              {modelName}
            </span>
          </div>

          <div className="flex-1" />

          {isStreaming && (
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[12px] text-[var(--accent)] mr-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              Streaming
            </span>
          )}

          <div
            className="hidden sm:flex items-center gap-1.5 text-[12px] tabular-nums text-[var(--text-secondary)] px-3 py-1.5 rounded-full bg-[var(--bg-tertiary)]"
            title="Баланс токенов"
          >
            <Zap size={13} className="text-[var(--warning)]" />
            {user.token_balance.toLocaleString()}
          </div>

          {user.role === "admin" && (
            <button
              onClick={() => setAdminOpen(true)}
              className="btn-icon"
              title="Админ-панель"
            >
              <Shield size={18} />
            </button>
          )}
          <button
            onClick={() => setAccountOpen(true)}
            className="btn-icon"
            title="Аккаунт"
          >
            <UserIcon size={18} />
          </button>
          <button
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className="hidden lg:flex btn-icon"
            title="Toggle settings"
          >
            {rightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
        </header>

        {user.status === "suspended" && (
          <div className="bg-[#fdd663]/10 border-b border-[#fdd663]/30 text-[var(--warning)] text-[13px] px-5 py-2.5">
            Аккаунт временно приостановлен. Чат недоступен.
          </div>
        )}

        <ChatWindow
          messages={active?.messages || []}
          isStreaming={isStreaming}
          onSuggestionClick={handleSend}
        />
        <InputBar
          onSend={handleSend}
          isStreaming={isStreaming}
          disabled={user.status !== "active"}
          modelName={modelName}
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
