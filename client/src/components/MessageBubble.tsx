import { Sparkles, Copy, Check, User as UserIcon } from "lucide-react";
import { useState } from "react";
import type { Message } from "../types";

interface Props {
  message: Message;
  isLast?: boolean;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isLast, isStreaming }: Props) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const showCursor = !isUser && isLast && isStreaming && !message.content;

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isUser) {
    return (
      <div className="group flex gap-3 mb-6 justify-end">
        <div className="max-w-[85%]">
          <div className="bg-[var(--bg-tertiary)] rounded-2xl rounded-tr-md px-4 py-2.5 text-[14px] text-[var(--text-primary)] whitespace-pre-wrap break-words leading-relaxed">
            {message.content}
          </div>
        </div>
        <div className="w-7 h-7 rounded-full bg-[var(--bg-active)] flex items-center justify-center shrink-0 mt-0.5 text-[var(--text-secondary)]">
          <UserIcon size={14} />
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-3 mb-6">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#8ab4f8] to-[#c58af9] flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles size={13} className="text-[#1f1f1f]" strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap break-words text-[var(--text-primary)] leading-[1.65] text-[14px]">
          {message.content}
          {showCursor && <span className="cursor-blink" />}
        </div>
        {message.content && (
          <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
              title="Copy"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
