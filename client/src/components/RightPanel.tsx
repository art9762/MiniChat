import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { Model, Settings } from "../types";

const MODELS: Model[] = [
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", provider: "anthropic" },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic" },
  { id: "claude-sonnet-4-6-1m", name: "Claude Sonnet 4.6 1M", provider: "anthropic" },
  { id: "claude-opus-4-6-1m", name: "Claude Opus 4.6 1M", provider: "anthropic" },
  { id: "claude-opus-4-7-1m", name: "Claude Opus 4.7 1M", provider: "anthropic" },
  { id: "gpt-5.4", name: "GPT-5.4", provider: "openai" },
  { id: "gpt-5.2", name: "GPT-5.2", provider: "openai" },
  { id: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai" },
];

const MODEL_INFO: Record<string, { description: string; tier: string }> = {
  "claude-opus-4-7": { description: "Most capable reasoning model with deep analysis", tier: "premium" },
  "claude-opus-4-6": { description: "Advanced reasoning and complex task handling", tier: "premium" },
  "claude-sonnet-4-6": { description: "Balanced performance and speed", tier: "standard" },
  "claude-haiku-4-5": { description: "Fast and lightweight for simple tasks", tier: "fast" },
  "claude-sonnet-4-6-1m": { description: "Sonnet 4.6 with 1M context window", tier: "standard" },
  "claude-opus-4-6-1m": { description: "Opus 4.6 with 1M context window", tier: "premium" },
  "claude-opus-4-7-1m": { description: "Opus 4.7 with 1M context window", tier: "premium" },
  "gpt-5.4": { description: "Latest GPT model with broad capabilities", tier: "premium" },
  "gpt-5.2": { description: "Balanced GPT model for everyday use", tier: "standard" },
  "gpt-5-mini": { description: "Fast and cost-effective GPT model", tier: "fast" },
};

const TIER_COLORS: Record<string, string> = {
  premium: "bg-amber-500/15 text-amber-400",
  standard: "bg-blue-500/15 text-blue-400",
  fast: "bg-emerald-500/15 text-emerald-400",
};

interface Props {
  model: string;
  onModelChange: (model: string) => void;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}

export function RightPanel({ model, onModelChange, settings, onSettingsChange }: Props) {
  const [modelListOpen, setModelListOpen] = useState(false);
  const current = MODELS.find((m) => m.id === model);
  const info = MODEL_INFO[model];

  return (
    <aside className="w-72 border-l border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col overflow-y-auto hidden lg:flex">
      <div className="p-4 space-y-5">
        {/* Model selector */}
        <div>
          <button
            onClick={() => setModelListOpen(!modelListOpen)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-sm font-medium text-[var(--text-primary)] transition-colors"
          >
            <span className="truncate">{current?.name || model}</span>
            {modelListOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {modelListOpen && (
            <div className="mt-1 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border)] overflow-hidden">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onModelChange(m.id);
                    setModelListOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between ${
                    m.id === model
                      ? "bg-blue-500/10 text-blue-400"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <span>{m.name}</span>
                  <span className="text-[10px] text-[var(--text-muted)] uppercase">{m.provider}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Model info */}
        {info && (
          <div className="rounded-xl bg-[var(--bg-tertiary)] p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[var(--text-primary)]">{current?.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase ${TIER_COLORS[info.tier]}`}>
                {info.tier}
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">{info.description}</p>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-[var(--border)]" />

        {/* System prompt */}
        <div>
          <label className="text-xs font-medium text-[var(--text-secondary)] block mb-2">
            System instructions
          </label>
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => onSettingsChange({ ...settings, systemPrompt: e.target.value })}
            rows={4}
            placeholder="You are a helpful assistant..."
            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500/50 resize-none transition-colors"
          />
        </div>

        {/* Temperature */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-[var(--text-secondary)]">Temperature</label>
            <span className="text-xs tabular-nums text-[var(--text-muted)]">{settings.temperature.toFixed(1)}</span>
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
            className="w-full accent-blue-500 h-1"
          />
          <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1">
            <span>Precise</span>
            <span>Creative</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
