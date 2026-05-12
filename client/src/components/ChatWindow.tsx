import { useRef, useEffect } from "react";
import { MessageBubble } from "./MessageBubble";
import { Terminal } from "lucide-react";
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
        <div className="text-center max-w-md">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] mb-4">
            <Terminal size={18} className="text-[var(--text-muted)]" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
            New conversation
          </h2>
          <p className="text-xs text-[var(--text-muted)] mb-5">
            Select a model and start chatting
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => onSuggestionClick(s)}
                className="text-left px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-focus)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
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
      <div className="max-w-3xl mx-auto py-2">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
