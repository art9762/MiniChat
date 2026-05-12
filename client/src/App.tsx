import { useState, useCallback } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { ChatWindow } from "./components/ChatWindow";
import { InputBar } from "./components/InputBar";
import { ModelSelector } from "./components/ModelSelector";
import { SettingsPanel } from "./components/SettingsPanel";
import { useConversations } from "./hooks/useConversations";
import { useChat } from "./hooks/useChat";
import type { Settings, Message } from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-6";

function App() {
  const { conversations, active, activeId, setActiveId, create, update, remove } =
    useConversations();
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    <div className="h-full flex bg-zinc-950 text-zinc-100">
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
        <header className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-2 hover:bg-zinc-800 rounded-lg"
          >
            <Menu size={18} />
          </button>
          <ModelSelector value={model} onChange={handleModelChange} />
          <div className="flex-1" />
          <SettingsPanel settings={settings} onChange={handleSettingsChange} />
        </header>
        <ChatWindow messages={active?.messages || []} />
        <InputBar onSend={handleSend} isStreaming={isStreaming} />
      </main>
    </div>
  );
}

export default App;
