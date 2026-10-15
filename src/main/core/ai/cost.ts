import type { AIClassifyInput } from '@shared/types'

/**
 * Cost model (docs/03 §7). Prices per 1M tokens for claude-haiku-5-5 with prompts ≤100K tokens.
 * The newer tokenizer produces ~30% more tokens than character heuristics suggest.
 */
import type { Prices } from '@shared/models'

export const HAIKU_PRICES: Prices = {
  input: 0.1,
  output: 0.5,
  cacheWrite: 0.125,
  cacheRead: 0.01,
}
export const TOKENIZER_FACTOR = 1.3
export const SYSTEM_PROMPT_TOKENS = 1200
export const WRAP_TOKENS_PER_REQUEST = 150
export const OUTPUT_TOKENS_PER_FILE = 120
/** Room for (low-effort) adaptive thinking per request. */
export const THINKING_TOKENS_PER_REQUEST = 400

/** Image tokens ≈ (w × h) / 750 at the thumbnail size actually sent. */
export function imageTokens(width: number, height: number, maxEdge: number): number {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1))
  return Math.ceil((Math.round(width * scale) * Math.round(height * scale)) / 750)
}

const textTokens = (s: string | undefined): number =>
  s ? Math.ceil((s.length / 4) * TOKENIZER_FACTOR) : 0

export function inputTokensFor(
  f: AIClassifyInput,
  imageEdge = 768,
  imgDims?: { w: number; h: number },
): number {
  let t = 40 + textTokens(f.name) + textTokens(f.metaSummary) + textTokens(f.textExcerpt)
  if (f.imageJpegBase64)
    t += imgDims
      ? imageTokens(imgDims.w, imgDims.h, imageEdge)
      : imageTokens(imageEdge, Math.round(imageEdge * 0.75), imageEdge)
  return t
}

export interface CostBreakdown {
  tokensIn: number
  tokensOut: number
  cacheWrite: number
  cacheRead: number
  usd: number
}

/** Whole-run estimate for `requests` batches (system prompt written once, then read from cache). */
export function estimateRun(
  files: AIClassifyInput[],
  requests: number,
  opts: { imageEdge?: number; batchApi?: boolean; prices?: Prices } = {},
): CostBreakdown {
  const p = opts.prices ?? HAIKU_PRICES
  if (!files.length || !requests)
    return { tokensIn: 0, tokensOut: 0, cacheWrite: 0, cacheRead: 0, usd: 0 }
  const fileIn = files.reduce((a, f) => a + inputTokensFor(f, opts.imageEdge), 0)
  const tokensIn = fileIn + requests * WRAP_TOKENS_PER_REQUEST
  const tokensOut = files.length * OUTPUT_TOKENS_PER_FILE + requests * THINKING_TOKENS_PER_REQUEST
  const cacheWrite = SYSTEM_PROMPT_TOKENS
  const cacheRead = SYSTEM_PROMPT_TOKENS * Math.max(0, requests - 1)
  let usd =
    (tokensIn * p.input +
      tokensOut * p.output +
      cacheWrite * p.cacheWrite +
      cacheRead * p.cacheRead) /
    1_000_000
  if (opts.batchApi) usd *= 0.5
  return { tokensIn: tokensIn + cacheWrite + cacheRead, tokensOut, cacheWrite, cacheRead, usd }
}

/** Real cost from API usage numbers. */
export function usageCost(
  u: { tokensIn: number; tokensOut: number; cacheWrite: number; cacheRead: number },
  batchApi = false,
  p: Prices = HAIKU_PRICES,
): number {
  const usd =
    (u.tokensIn * p.input +
      u.tokensOut * p.output +
      u.cacheWrite * p.cacheWrite +
      u.cacheRead * p.cacheRead) /
    1_000_000
  return batchApi ? usd * 0.5 : usd
}
