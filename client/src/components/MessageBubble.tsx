import { User, Bot } from "lucide-react";
import type { Message } from "../types";

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`px-4 py-4 ${isUser ? "" : "bg-[var(--bg-secondary)]/50"}`}>
      <div className="max-w-3xl mx-auto flex gap-3">
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
            isUser
              ? "bg-blue-500/15 text-blue-400"
              : "bg-emerald-500/15 text-emerald-400"
          }`}
        >
          {isUser ? <User size={14} /> : <Bot size={14} />}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-xs font-medium mb-1.5 text-[var(--text-muted)]">
            {isUser ? "You" : "Assistant"}
          </p>
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap break-words text-[var(--text-primary)] leading-relaxed">
            {message.content}
          </div>
        </div>
      </div>
    </div>
  );
}
