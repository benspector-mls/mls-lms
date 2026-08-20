/**
 * What a grading run costs, from the token counts the provider reports.
 *
 * Rates live here and nowhere else. They are published numbers that change on Anthropic's
 * schedule rather than on this repository's, and a second copy is the failure that
 * actually happened: a stale table priced Sonnet at $3/$15 long after it moved to $2/$10,
 * and every figure derived from it was wrong by half without being obviously wrong.
 *
 * No dollar figure is ever stored on a row. A price is a fact about the rate card, not
 * about a grading run, so `model_metadata.usage` keeps the four token counts and the
 * arithmetic happens here — which means a table can be re-derived at any time from runs
 * that already happened rather than from runs commissioned to measure cost.
 *
 * Deliberately free of `server-only` and of any database import, so scripts, the app, and
 * the calibration harness can all price the same way.
 */

/**
 * Published rates in US dollars per million tokens, input and output.
 *
 * Sonnet is the deployed default and Opus is here because the first cost table was
 * measured on it, so a comparison between the two tiers stays reproducible rather than
 * remembered. Keyed by the exact model identifier the provider reports, so a model with no
 * entry is reported as unpriced instead of being silently costed at another tier's rate.
 */
export const RATES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
};

/**
 * Cached input is billed at roughly a tenth of the input rate, and writing the cache at
 * 1.25 times it on the five-minute lifetime this pipeline uses. Both are multipliers on
 * whatever the model's input rate is, which is why they are factors here rather than four
 * more numbers per model.
 */
export const CACHE_READ_FACTOR = 0.1;
export const CACHE_WRITE_FACTOR = 1.25;

export type Usage = {
  promptTokens: number;
  cachedPromptTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
};

export type PricedUsage = {
  /** Dollars, split so the output share can be read off rather than recomputed. */
  inputCost: number;
  outputCost: number;
  total: number;
  /**
   * What the same run would have cost had its cacheable prefix been read rather than
   * written. This is the honest basis for a cohort graded in one sitting, where the first
   * submission pays the write and the rest read it, and it is the only basis on which two
   * runs are comparable — a tier comparison where one side happened to write the cache and
   * the other to read it measures cache state rather than the tier. Reported beside the
   * billed figure rather than instead of it, because the gap between the two *is* the
   * value of grading in a burst.
   */
  normalizedTotal: number;
};

/** Null when the model has no entry in `RATES`, so an unpriced run reads as unpriced. */
export function priceUsage(usage: Usage, model: string): PricedUsage | null {
  const rate = RATES[model];
  if (!rate) return null;

  const perToken = rate.input / 1_000_000;
  const inputCost =
    usage.promptTokens * perToken +
    usage.cachedPromptTokens * perToken * CACHE_READ_FACTOR +
    usage.cacheWriteTokens * perToken * CACHE_WRITE_FACTOR;
  const outputCost = usage.completionTokens * (rate.output / 1_000_000);

  // The cacheable prefix is whichever count is non-zero: a run either read it or wrote it,
  // never both. Priced here as a read in either case.
  const cacheable = usage.cachedPromptTokens + usage.cacheWriteTokens;
  const normalizedTotal =
    usage.promptTokens * perToken + cacheable * perToken * CACHE_READ_FACTOR + outputCost;

  return { inputCost, outputCost, total: inputCost + outputCost, normalizedTotal };
}

export const money = (dollars: number) => `$${dollars.toFixed(4)}`;
