import { useState, useRef, useEffect } from "react";
import { ArrowUp, Square } from "lucide-react";

interface Props {
  onSend: (text: string) => void;
  isStreaming: boolean;
  disabled?: boolean;
}

export function InputBar({ onSend, isStreaming, disabled }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isStreaming) ref.current?.focus();
  }, [isStreaming]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || disabled) return;
    onSend(trimmed);
    setText("");
    if (ref.current) {
      ref.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="p-4 pt-2">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex items-end bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-2xl px-4 py-3 focus-within:border-blue-500/40 transition-colors">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={disabled ? "Чат недоступен" : "Type a message..."}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none min-h-[24px] max-h-[200px] leading-relaxed"
            style={{ height: "auto", overflow: "hidden" }}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 200) + "px";
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={disabled || (!text.trim() && !isStreaming)}
            className="shrink-0 w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-muted)] flex items-center justify-center transition-colors ml-2"
          >
            {isStreaming ? <Square size={12} /> : <ArrowUp size={16} />}
          </button>
        </div>
        <p className="text-[10px] text-[var(--text-muted)] text-center mt-2">
          MiniChat may make mistakes. Check important information.
        </p>
      </div>
    </div>
  );
}
