import { useRef, useEffect } from "react";
import { MessageBubble } from "./MessageBubble";
import { Sparkles } from "lucide-react";
import type { Message } from "../types";

const SUGGESTIONS = [
  { title: "Explain a concept", prompt: "Explain quantum computing in simple terms" },
  { title: "Write code", prompt: "Write a Python function for binary search" },
  { title: "Brainstorm ideas", prompt: "Help me brainstorm startup ideas in education tech" },
  { title: "Translate", prompt: "Translate this text to English: «Привет, как дела?»" },
];

interface Props {
  messages: Message[];
  isStreaming: boolean;
  onSuggestionClick: (text: string) => void;
}

export function ChatWindow({ messages, isStreaming, onSuggestionClick }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 overflow-y-auto">
        <div className="w-full max-w-2xl py-12">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#8ab4f8] to-[#c58af9] flex items-center justify-center">
              <Sparkles size={20} className="text-[#1f1f1f]" strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="text-[28px] font-normal text-[var(--text-primary)] leading-tight">
                Hello, there
              </h1>
              <p className="text-[14px] text-[var(--text-muted)]">
                How can I help you today?
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.title}
                onClick={() => onSuggestionClick(s.prompt)}
                className="text-left p-4 rounded-xl bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors group"
              >
                <div className="text-[13px] font-medium text-[var(--text-primary)] mb-1">
                  {s.title}
                </div>
                <div className="text-[12px] text-[var(--text-muted)] line-clamp-2">
                  {s.prompt}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6">
        {messages.map((msg, idx) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isLast={idx === messages.length - 1}
            isStreaming={isStreaming}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
