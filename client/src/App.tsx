import { useState, useCallback } from "react";
import { Menu, PanelRight } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { ChatWindow } from "./components/ChatWindow";
import { InputBar } from "./components/InputBar";
import { RightPanel } from "./components/RightPanel";
import { useConversations } from "./hooks/useConversations";
import { useChat } from "./hooks/useChat";
import type { Settings, Message } from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-6";

function App() {
  const { conversations, active, activeId, setActiveId, create, update, remove } =
    useConversations();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
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
    handleMessagesUpdate
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
        <header className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-2 hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
          >
            <Menu size={18} />
          </button>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">
            {active?.title || "MiniChat"}
          </h1>
          <div className="flex-1" />
          <button
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className="hidden lg:flex p-2 hover:bg-[var(--bg-hover)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Toggle settings panel"
          >
            <PanelRight size={18} />
          </button>
        </header>
        <ChatWindow messages={active?.messages || []} onSuggestionClick={handleSend} />
        <InputBar onSend={handleSend} isStreaming={isStreaming} />
      </main>
      {rightPanelOpen && (
        <RightPanel
          model={model}
          onModelChange={handleModelChange}
          settings={settings}
          onSettingsChange={handleSettingsChange}
        />
      )}
    </div>
  );
}

export default App;
