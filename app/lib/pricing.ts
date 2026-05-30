/**
 * Plan 27: static per-model pricing for the Insights cost-estimate tile.
 *
 * Cost = tokens * rate / 1e6 (rates are USD per million tokens).
 *
 * Not pulled from any live API — providers don't publish a stable price
 * endpoint and prices change slowly. Users who run an alternative model
 * (Ollama, a self-hosted mirror) can either add an entry here or accept
 * the "—" fallback the Insights page shows for unknown ids.
 *
 * Sources (re-check before bumping numbers):
 *   - Anthropic: https://www.anthropic.com/pricing
 *   - OpenAI:    https://openai.com/api/pricing
 *   - Google:    https://ai.google.dev/pricing
 *
 * last verified: 2026-05-31
 */
export interface ModelPricing {
  /** USD per 1M input tokens. */
  input_per_1m: number
  /** USD per 1M output tokens. */
  output_per_1m: number
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude 4.x — same tiering as the 3.x line.
  'claude-opus-4-7': { input_per_1m: 15, output_per_1m: 75 },
  'claude-opus-4-6': { input_per_1m: 15, output_per_1m: 75 },
  'claude-sonnet-4-6': { input_per_1m: 3, output_per_1m: 15 },
  'claude-haiku-4-5-20251001': { input_per_1m: 1, output_per_1m: 5 },

  // OpenAI flagship + smaller siblings.
  'gpt-4o': { input_per_1m: 5, output_per_1m: 15 },
  'gpt-4o-mini': { input_per_1m: 0.15, output_per_1m: 0.6 },
  'gpt-4-turbo': { input_per_1m: 10, output_per_1m: 30 },

  // Google Gemini.
  'gemini-1.5-pro': { input_per_1m: 3.5, output_per_1m: 10.5 },
  'gemini-1.5-flash': { input_per_1m: 0.075, output_per_1m: 0.3 },
}

export function estimateCostUsd(
  model: string,
  input_tokens: number,
  output_tokens: number,
): number | null {
  const rate = MODEL_PRICING[model]
  if (!rate) return null
  return (
    (input_tokens * rate.input_per_1m + output_tokens * rate.output_per_1m) /
    1_000_000
  )
}

/**
 * Aggregate a per-model breakdown into a single USD figure. Returns null
 * when no row matches a known model (so the tile renders "—" rather than
 * misleading $0.00).
 */
export function estimateTotalCostUsd(
  breakdown: ReadonlyArray<{
    model: string
    input_tokens: number
    output_tokens: number
  }>,
): number | null {
  let total = 0
  let matched = false
  for (const row of breakdown) {
    const cost = estimateCostUsd(row.model, row.input_tokens, row.output_tokens)
    if (cost !== null) {
      matched = true
      total += cost
    }
  }
  return matched ? total : null
}
