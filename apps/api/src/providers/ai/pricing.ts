/**
 * Token pricing used to estimate AI spend, in USD per 1 million tokens.
 *
 * These are *estimates*, and the platform treats them as such: the cost dashboard labels
 * every figure "estimated". Prices change, so administrators can override this table in
 * Settings → AI. A model that is not listed reports `null` cost rather than a made-up
 * number — the dashboard then shows "Unknown" for that portion of the spend.
 */
export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const DEFAULT_MODEL_PRICING: Record<string, ModelPrice> = {
  // OpenAI
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  // Anthropic (Sonnet tier)
  'claude-sonnet-5': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-3-5-sonnet-latest': { inputPerMillion: 3, outputPerMillion: 15 },
};

/**
 * Estimate the cost of a call. Returns null when the model is unpriced — the caller
 * must then record "unknown", never zero, so the budget guard cannot be fooled into
 * thinking an expensive model is free.
 */
export function estimateCostUsd(
  model: string,
  promptTokens: number | undefined,
  completionTokens: number | undefined,
  table: Record<string, ModelPrice> = DEFAULT_MODEL_PRICING,
): number | null {
  const price = table[model] ?? table[model.replace(/-\d{8}$/, '')] ?? null;
  if (!price) return null;
  const inTok = promptTokens ?? 0;
  const outTok = completionTokens ?? 0;
  if (!inTok && !outTok) return null;
  return (inTok / 1_000_000) * price.inputPerMillion + (outTok / 1_000_000) * price.outputPerMillion;
}
