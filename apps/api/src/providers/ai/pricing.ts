/**
 * Token pricing used to estimate AI spend, in USD per 1 million tokens.
 *
 * Every figure derived from this table is an *estimate*, and the platform never calls it
 * anything else. Three rules keep it honest:
 *
 *   1. Vendors change prices whenever they like, and this table cannot know when they
 *      do. Administrators override it in Settings → AI with the prices on their own
 *      invoice, which are the only authoritative numbers.
 *   2. A model that is not listed reports `null`, never zero. Treating an unpriced
 *      model as free would let it run past the monthly ceiling unnoticed, which is the
 *      exact failure the ceiling exists to prevent.
 *   3. Unpriced calls are counted separately (ProviderUsage.unpricedRequests) so the
 *      budget panel can say "estimated $12 plus 40 calls of unknown cost" rather than
 *      implying the estimate is the whole story.
 *
 * The defaults below are a starting point for the models this project was tested with.
 * Verify them against your own billing before relying on the ceiling.
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
