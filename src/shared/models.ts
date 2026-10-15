/**
 * Claude models offered in Settings (revision 2). Prices are USD per 1M tokens for prompts
 * ≤100K tokens (Döndü's requests are always far smaller). Cache: write 1.25×, read 0.1× input.
 */
export interface ModelPreset {
  id: string
  name: string
  input: number
  output: number
  /** i18n key suffix: settings.modelNote.<note> */
  note: 'fast' | 'smart' | 'smartest'
  /** Server-side refusal fallback ("fallbacks: default") is available for this model. */
  fallback: boolean
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    input: 0.1,
    output: 0.5,
    note: 'fast',
    fallback: false,
  },
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    input: 2,
    output: 10,
    note: 'smart',
    fallback: true,
  },
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    input: 4,
    output: 20,
    note: 'smartest',
    fallback: true,
  },
]

export const DEFAULT_UNDERSTAND_MODEL = 'claude-haiku-5-5'
export const DEFAULT_ORGANIZE_MODEL = 'claude-sonnet-5-5'

export interface Prices {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

/**
 * Prices for a model id. Unknown ("Diğer…") models are priced like the most expensive preset so
 * the cost guard never under-estimates.
 */
export function pricesFor(model: string): Prices {
  const p =
    MODEL_PRESETS.find((m) => m.id === model) ??
    [...MODEL_PRESETS].sort((a, b) => b.input - a.input)[0]!
  return { input: p.input, output: p.output, cacheWrite: p.input * 1.25, cacheRead: p.input * 0.1 }
}

export function presetFor(model: string): ModelPreset | undefined {
  return MODEL_PRESETS.find((m) => m.id === model)
}
