import { useState, useRef, useEffect } from "react";
import { ArrowUp, Square, Plus } from "lucide-react";

interface Props {
  onSend: (text: string) => void;
  isStreaming: boolean;
  disabled?: boolean;
  modelName?: string;
}

export function InputBar({ onSend, isStreaming, disabled, modelName }: Props) {
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
    <div className="px-4 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex items-end bg-[var(--bg-tertiary)] rounded-3xl px-2 py-2 transition-shadow focus-within:shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
          <button
            disabled
            className="shrink-0 w-9 h-9 rounded-full hover:bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-muted)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Attachments (coming soon)"
          >
            <Plus size={18} />
          </button>
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={disabled ? "Чат недоступен" : "Type something..."}
            rows={1}
            className="flex-1 resize-none bg-transparent text-[14px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none min-h-[24px] max-h-[200px] leading-relaxed py-2 px-1"
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
            className="shrink-0 w-9 h-9 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--bg-active)] disabled:text-[var(--text-faint)] flex items-center justify-center transition-colors text-[#1f1f1f]"
            title={isStreaming ? "Stop" : "Send (Enter)"}
          >
            {isStreaming ? <Square size={14} fill="currentColor" /> : <ArrowUp size={18} strokeWidth={2.4} />}
          </button>
        </div>
        <div className="flex items-center justify-center mt-2 gap-1">
          <p className="text-[11px] text-[var(--text-faint)]">
            MiniChat may display inaccurate info, including about people, so double-check responses.{modelName && <span className="ml-1">· {modelName}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}
