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

  const charCount = text.length;

  return (
    <div className="p-3 pt-1.5">
      <div className="composer-wrap">
        <div className="composer flex items-end px-3 py-2.5">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={disabled ? "Чат недоступен" : "Send a message..."}
            rows={1}
            className="flex-1 resize-none bg-transparent text-[13px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none min-h-[22px] max-h-[200px] leading-relaxed"
            style={{ height: "auto", overflow: "hidden" }}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 200) + "px";
            }}
          />
          <div className="flex items-center gap-2 ml-2">
            {charCount > 0 && (
              <span className="text-[10px] tabular-nums text-[var(--text-muted)]">
                {charCount}
              </span>
            )}
            <button
              onClick={handleSubmit}
              disabled={disabled || (!text.trim() && !isStreaming)}
              className="shrink-0 w-8 h-8 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-muted)] flex items-center justify-center transition-colors text-white"
            >
              {isStreaming ? <Square size={11} /> : <ArrowUp size={15} />}
            </button>
          </div>
        </div>
        <p className="text-[10px] text-[var(--text-muted)] text-center mt-1.5">
          Shift+Enter — новая строка
        </p>
      </div>
    </div>
  );
}
