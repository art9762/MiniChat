import { ChevronDown, ChevronUp, Cpu, Thermometer, FileText, Zap, Crown, Gauge } from "lucide-react";
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

const MODEL_INFO: Record<string, { description: string; tier: string; context: string }> = {
  "claude-opus-4-7": { description: "Most capable reasoning model", tier: "premium", context: "200K" },
  "claude-opus-4-6": { description: "Advanced reasoning and analysis", tier: "premium", context: "200K" },
  "claude-sonnet-4-6": { description: "Balanced performance and speed", tier: "standard", context: "200K" },
  "claude-haiku-4-5": { description: "Fast and lightweight", tier: "fast", context: "200K" },
  "claude-sonnet-4-6-1m": { description: "Sonnet with extended context", tier: "standard", context: "1M" },
  "claude-opus-4-6-1m": { description: "Opus 4.6 extended context", tier: "premium", context: "1M" },
  "claude-opus-4-7-1m": { description: "Opus 4.7 extended context", tier: "premium", context: "1M" },
  "gpt-5.4": { description: "Latest GPT flagship model", tier: "premium", context: "128K" },
  "gpt-5.2": { description: "Balanced GPT for everyday use", tier: "standard", context: "128K" },
  "gpt-5-mini": { description: "Fast and cost-effective", tier: "fast", context: "128K" },
};

const TIER_ICON: Record<string, typeof Crown> = {
  premium: Crown,
  standard: Zap,
  fast: Gauge,
};

const TIER_COLORS: Record<string, string> = {
  premium: "text-amber-500",
  standard: "text-blue-400",
  fast: "text-emerald-400",
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

  const providers = [...new Set(MODELS.map(m => m.provider))];

  return (
    <aside className="w-64 border-l border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col overflow-y-auto hidden lg:flex">
      <div className="p-3 space-y-4">
        {/* Model selector */}
        <div>
          <div className="section-label mb-1.5 flex items-center gap-1">
            <Cpu size={10} />
            Model
          </div>
          <button
            onClick={() => setModelListOpen(!modelListOpen)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] hover:border-[var(--border-focus)] text-xs font-medium text-[var(--text-primary)] transition-all"
          >
            <span className="truncate">{current?.name || model}</span>
            {modelListOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {modelListOpen && (
            <div className="mt-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] overflow-hidden max-h-64 overflow-y-auto">
              {providers.map(provider => (
                <div key={provider}>
                  <div className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-primary)]">
                    {provider}
                  </div>
                  {MODELS.filter(m => m.provider === provider).map((m) => {
                    const mInfo = MODEL_INFO[m.id];
                    const TierIcon = mInfo ? TIER_ICON[mInfo.tier] : Zap;
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          onModelChange(m.id);
                          setModelListOpen(false);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                          m.id === model
                            ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        <TierIcon size={10} className={mInfo ? TIER_COLORS[mInfo.tier] : ""} />
                        <span className="flex-1 truncate">{m.name}</span>
                        {mInfo && (
                          <span className="text-[9px] text-[var(--text-muted)] font-mono">{mInfo.context}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Model info card */}
        {info && (
          <div className="rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] p-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5">
              {(() => { const TierIcon = TIER_ICON[info.tier]; return <TierIcon size={10} className={TIER_COLORS[info.tier]} />; })()}
              <span className="text-[11px] font-semibold text-[var(--text-primary)]">{current?.name}</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{info.description}</p>
            <div className="flex gap-3 pt-0.5">
              <div className="text-[10px] text-[var(--text-muted)]">
                <span className="text-[var(--text-secondary)]">Context:</span> {info.context}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                <span className="text-[var(--text-secondary)]">Tier:</span> {info.tier}
              </div>
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-[var(--border)]" />

        {/* System prompt */}
        <div>
          <div className="section-label mb-1.5 flex items-center gap-1">
            <FileText size={10} />
            System prompt
          </div>
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => onSettingsChange({ ...settings, systemPrompt: e.target.value })}
            rows={4}
            placeholder="You are a helpful assistant..."
            className="w-full bg-[var(--bg-input)] border border-[var(--border)] rounded-md px-2.5 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] resize-none transition-colors font-mono leading-relaxed"
          />
        </div>

        {/* Temperature */}
        <div>
          <div className="section-label mb-1.5 flex items-center gap-1">
            <Thermometer size={10} />
            Temperature
          </div>
          <div className="bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md p-2.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[var(--text-secondary)]">{settings.temperature.toFixed(1)}</span>
              <div className="flex gap-1">
                {[0, 0.5, 1.0, 1.5, 2.0].map(v => (
                  <button
                    key={v}
                    onClick={() => onSettingsChange({ ...settings, temperature: v })}
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                      settings.temperature === v
                        ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    {v.toFixed(1)}
                  </button>
                ))}
              </div>
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
            <div className="flex justify-between text-[9px] text-[var(--text-muted)] mt-1">
              <span>Deterministic</span>
              <span>Creative</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
