import { User, Bot, Copy, Check } from "lucide-react";
import { useState } from "react";
import type { Message } from "../types";

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`group px-4 py-3 ${isUser ? "" : "bg-[var(--bg-secondary)]"}`}>
      <div className="max-w-3xl mx-auto flex gap-3">
        <div
          className={`w-6 h-6 rounded flex items-center justify-center shrink-0 mt-0.5 ${
            isUser
              ? "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
              : "bg-[var(--accent-subtle)] text-[var(--accent)]"
          }`}
        >
          {isUser ? <User size={12} /> : <Bot size={12} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">
              {isUser ? "You" : "Assistant"}
            </p>
            {!isUser && (
              <button
                onClick={handleCopy}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-[var(--text-primary)] text-[var(--text-muted)] transition-all"
                title="Copy"
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
              </button>
            )}
          </div>
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap break-words text-[var(--text-primary)] leading-relaxed text-[13px]">
            {message.content}
          </div>
        </div>
      </div>
    </div>
  );
}
