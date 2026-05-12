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

export function priceOf(model: string): Pricing {
  return PRICING[model] ?? DEFAULT;
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
