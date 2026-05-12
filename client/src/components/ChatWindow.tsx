import { useRef, useEffect } from "react";
import { MessageBubble } from "./MessageBubble";
import { Sparkles } from "lucide-react";
import type { Message } from "../types";

const SUGGESTIONS = [
  "Explain quantum computing in simple terms",
  "Write a Python function for binary search",
  "Help me brainstorm startup ideas",
  "Translate this text to English",
];

interface Props {
  messages: Message[];
  onSuggestionClick: (text: string) => void;
}

export function ChatWindow({ messages, onSuggestionClick }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center max-w-lg">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 mb-4">
            <Sparkles size={22} className="text-blue-400" />
          </div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-1">
            How can I help you?
          </h2>
          <p className="text-sm text-[var(--text-muted)] mb-6">
            Start a conversation or try one of these suggestions
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => onSuggestionClick(s)}
                className="text-left px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto py-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
