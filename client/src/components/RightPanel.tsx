import { ChevronDown, Check, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { Model, Settings, ChatSettings } from "../types";

const MODELS: Model[] = [
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", provider: "anthropic" },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic" },
  { id: "claude-sonnet-4-6-1m", name: "Claude Sonnet 4.6 (1M)", provider: "anthropic" },
  { id: "claude-opus-4-6-1m", name: "Claude Opus 4.6 (1M)", provider: "anthropic" },
  { id: "claude-opus-4-7-1m", name: "Claude Opus 4.7 (1M)", provider: "anthropic" },
  { id: "gpt-5.4", name: "GPT-5.4", provider: "openai" },
  { id: "gpt-5.2", name: "GPT-5.2", provider: "openai" },
  { id: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai" },
];

const MODEL_DESC: Record<string, string> = {
  "claude-opus-4-7": "Самая мощная модель для сложных задач",
  "claude-opus-4-6": "Продвинутое рассуждение и анализ",
  "claude-sonnet-4-6": "Баланс скорости и качества",
  "claude-haiku-4-5": "Быстрая и лёгкая",
  "claude-sonnet-4-6-1m": "Sonnet с расширенным контекстом 1M",
  "claude-opus-4-6-1m": "Opus 4.6 с контекстом 1M",
  "claude-opus-4-7-1m": "Opus 4.7 с контекстом 1M",
  "gpt-5.4": "Флагман GPT нового поколения",
  "gpt-5.2": "Сбалансированный GPT",
  "gpt-5-mini": "Быстрый и экономичный",
};

interface Props {
  model: string;
  onModelChange: (model: string) => void;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
  chatSettings: ChatSettings;
  onChatSettingsChange: (s: ChatSettings) => void;
  isProjectChat?: boolean;
  isOpen: boolean;
  onClose: () => void;
}

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

function ToggleRow({ label, description, checked, onChange, disabled }: ToggleRowProps) {
  return (
    <div className={`flex items-start gap-3 py-2 ${disabled ? "opacity-40" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[var(--text-primary)] font-medium leading-tight">{label}</div>
        <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">{description}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200 mt-0.5 ${
          checked && !disabled
            ? "bg-[var(--accent)]"
            : "bg-[var(--bg-active)]"
        } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

export function RightPanel({
  model,
  onModelChange,
  settings,
  onSettingsChange,
  chatSettings,
  onChatSettingsChange,
  isProjectChat,
  isOpen,
  onClose,
}: Props) {
  const [modelOpen, setModelOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = MODELS.find((m) => m.id === model);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setModelOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const cs = chatSettings;
  const set = (patch: Partial<ChatSettings>) => onChatSettingsChange({ ...cs, ...patch });

  return (
    <>
      {/* Mobile/tablet overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed lg:static top-0 right-0 h-full w-[88vw] max-w-[340px] lg:w-[280px] z-50 lg:z-auto bg-[var(--bg-primary)] flex flex-col overflow-y-auto border-l border-[var(--border-subtle)] transition-transform duration-200 lg:transition-none ${
          isOpen
            ? "translate-x-0"
            : "translate-x-full lg:translate-x-0 lg:hidden"
        }`}
      >
        <div className="px-4 py-5">
          <div className="flex items-center gap-2 mb-5">
            <SlidersHorizontal size={16} className="text-[var(--text-secondary)]" />
            <h2 className="text-[14px] font-medium text-[var(--text-primary)]">Настройки чата</h2>
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="btn-icon lg:hidden"
              aria-label="Закрыть"
            >
              <X size={18} />
            </button>
          </div>

          {/* Model */}
          <div className="mb-5">
            <label className="block studio-label mb-2">Модель</label>
            <div ref={ref} className="relative">
              <button
                onClick={() => setModelOpen(!modelOpen)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[13px] font-medium text-[var(--text-primary)] transition-colors"
              >
                <span className="flex items-center gap-2 truncate">
                  <Sparkles size={14} className="text-[var(--accent)] shrink-0" />
                  {current?.name || model}
                </span>
                <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${modelOpen ? "rotate-180" : ""}`} />
              </button>
              {modelOpen && (
                <div className="absolute z-20 mt-1 w-full max-h-[360px] overflow-y-auto rounded-lg bg-[var(--bg-elevated)] shadow-xl border border-[var(--border)]">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        onModelChange(m.id);
                        setModelOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 text-[13px] flex items-start gap-2 transition-colors ${
                        m.id === model
                          ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                          : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <div className="w-4 mt-0.5 shrink-0">
                        {m.id === model && <Check size={14} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{m.name}</div>
                        <div className="text-[11px] text-[var(--text-muted)] truncate">
                          {MODEL_DESC[m.id] || m.provider}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {current && MODEL_DESC[current.id] && (
              <p className="text-[12px] text-[var(--text-muted)] mt-2 leading-relaxed">
                {MODEL_DESC[current.id]}
              </p>
            )}
          </div>

          {/* Tools group */}
          <div className="mb-4">
            <div className="studio-label mb-2">Инструменты</div>
            <div className="rounded-lg bg-[var(--bg-tertiary)] px-3 divide-y divide-[var(--border-subtle)]">
              <ToggleRow
                label="🔎 Web Search"
                description="Поиск в интернете перед ответом"
                checked={cs.webSearch}
                onChange={(v) => set({ webSearch: v })}
              />
              <ToggleRow
                label="🌐 URL Fetch"
                description="Открывать ссылки из сообщений"
                checked={cs.urlFetch}
                onChange={(v) => set({ urlFetch: v })}
              />
              <ToggleRow
                label="💻 Code Execution"
                description="Запускать Python/JS в sandbox"
                checked={cs.codeExec}
                onChange={(v) => set({ codeExec: v })}
              />
            </div>
          </div>

          {/* Chat group */}
          <div className="mb-4">
            <div className="studio-label mb-2">Чат</div>
            <div className="rounded-lg bg-[var(--bg-tertiary)] px-3 divide-y divide-[var(--border-subtle)]">
              <ToggleRow
                label="📎 Attachments"
                description="Прикреплять файлы к сообщениям"
                checked={cs.attachmentsEnabled}
                onChange={(v) => set({ attachmentsEnabled: v })}
              />
              {/* Temperature inside Chat group */}
              <div className="py-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-[13px] text-[var(--text-primary)] font-medium leading-tight">🌡️ Temperature</div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5">Креативность ответов</div>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={settings.temperature}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) onSettingsChange({ ...settings, temperature: Math.min(2, Math.max(0, v)) });
                    }}
                    className="w-14 text-center bg-[var(--bg-hover)] border border-transparent focus:border-[var(--accent)] rounded-md px-2 py-1 text-[13px] text-[var(--text-primary)] outline-none transition-colors"
                  />
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={settings.temperature}
                  onChange={(e) =>
                    onSettingsChange({ ...settings, temperature: parseFloat(e.target.value) })
                  }
                  className="w-full"
                />
                <div className="flex justify-between text-[11px] text-[var(--text-faint)] mt-1">
                  <span>Точно</span>
                  <span>Креативно</span>
                </div>
              </div>
            </div>
          </div>

          {/* Project group */}
          <div className="mb-4">
            <div className="studio-label mb-2">Проект</div>
            <div className="rounded-lg bg-[var(--bg-tertiary)] px-3 divide-y divide-[var(--border-subtle)]">
              <ToggleRow
                label="🧠 Memory Auto-Update"
                description="Автообновлять память проекта"
                checked={cs.memoryAutoUpdate}
                onChange={(v) => set({ memoryAutoUpdate: v })}
                disabled={!isProjectChat}
              />
              <ToggleRow
                label="📚 RAG"
                description="Поиск по файлам проекта"
                checked={cs.rag}
                onChange={(v) => set({ rag: v })}
                disabled={!isProjectChat}
              />
            </div>
            {!isProjectChat && (
              <p className="text-[11px] text-[var(--text-faint)] mt-2">
                Только для чатов в проекте
              </p>
            )}
          </div>

          {/* System instructions */}
          <div className="mb-5">
            <label className="block studio-label mb-2">System instructions</label>
            <textarea
              value={settings.systemPrompt}
              onChange={(e) => onSettingsChange({ ...settings, systemPrompt: e.target.value })}
              rows={4}
              placeholder="Optional tone and style instructions for the model"
              className="studio-input resize-none leading-relaxed"
            />
          </div>

          {/* Footer note */}
          <div className="pt-3 mt-2 border-t border-[var(--border-subtle)]">
            <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">
              Настройки применяются к новым сообщениям. История чата сохраняется локально.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
