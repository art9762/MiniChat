// Per-model pricing in "cost units" per 1M tokens.
// Balance is denominated in the same units (1 unit = 1 token for fast tier baseline).
// Tweak freely without DB changes.

type Pricing = { input: number; output: number };

const PRICING: Record<string, Pricing> = {
  // Anthropic
  "claude-opus-4-7":     { input: 15, output: 75 },
  "claude-opus-4-7-1m":  { input: 30, output: 150 },
  "claude-opus-4-6":     { input: 15, output: 75 },
  "claude-opus-4-6-1m":  { input: 30, output: 150 },
  "claude-sonnet-4-6":   { input: 3,  output: 15 },
  "claude-sonnet-4-6-1m":{ input: 6,  output: 30 },
  "claude-haiku-4-5":    { input: 1,  output: 5 },
  // OpenAI
  "gpt-5.4":             { input: 10, output: 40 },
  "gpt-5.2":             { input: 3,  output: 12 },
  "gpt-5-mini":          { input: 0.5, output: 2 },
};

const DEFAULT: Pricing = { input: 5, output: 20 };

// The Claude Code CLI sends full Anthropic model IDs (e.g. "claude-sonnet-4-6-20250..."
// or "claude-3-5-haiku-...") that won't match the table exactly. Map by family so
// the agent billing proxy can still price unknown/dated IDs correctly.
function prefixPrice(model: string): Pricing | null {
  const m = model.toLowerCase();
  if (!m.startsWith("claude")) return null;
  const is1m = m.includes("1m") || m.includes("[1m]");
  if (m.includes("opus")) return is1m ? { input: 30, output: 150 } : { input: 15, output: 75 };
  if (m.includes("sonnet")) return is1m ? { input: 6, output: 30 } : { input: 3, output: 15 };
  if (m.includes("haiku")) return { input: 1, output: 5 };
  return null;
}

export function priceOf(model: string): Pricing {
  return PRICING[model] ?? prefixPrice(model) ?? DEFAULT;
}

// Cost in balance units for a request given token counts.
export function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceOf(model);
  // unit: 1 balance point ~= 1 token of cheapest tier; multiplier per model.
  // cost = price_per_M * tokens / 1000 (so balance ~ thousands)
  return Math.ceil((p.input * inputTokens + p.output * outputTokens) / 1000);
}

export function estimateInputTokens(text: string): number {
  // Rough estimate: 1 token ~= 4 chars. Used for pre-flight check only.
  return Math.ceil(text.length / 4);
}
