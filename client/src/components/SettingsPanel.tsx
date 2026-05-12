import { useState } from "react";
import { Settings as SettingsIcon, X } from "lucide-react";
import type { Settings } from "../types";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function SettingsPanel({ settings, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <SettingsIcon size={18} />
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-96 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">Settings</h2>
              <button
                onClick={() => setOpen(false)}
                className="p-1 hover:bg-zinc-800 rounded"
              >
                <X size={18} className="text-zinc-400" />
              </button>
            </div>
            <div>
              <label className="text-sm text-zinc-400 block mb-1">
                Temperature: {settings.temperature.toFixed(1)}
              </label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={settings.temperature}
                onChange={(e) =>
                  onChange({ ...settings, temperature: parseFloat(e.target.value) })
                }
                className="w-full accent-blue-500"
              />
            </div>
            <div>
              <label className="text-sm text-zinc-400 block mb-1">
                System Prompt
              </label>
              <textarea
                value={settings.systemPrompt}
                onChange={(e) =>
                  onChange({ ...settings, systemPrompt: e.target.value })
                }
                rows={4}
                placeholder="You are a helpful assistant..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 resize-none"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
