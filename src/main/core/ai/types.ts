import type { AIClassifyInput, AIClassifyOutput } from '@shared/types'

export type ProviderId = 'anthropic' | 'lmstudio' | 'none'

export interface Usage {
  tokensIn: number
  tokensOut: number
  cacheWrite: number
  cacheRead: number
}

/** Revision 1: a generic JSON request (understanding pass or folder-architect pass). */
export interface JsonRequest {
  pass: 'understand' | 'organize'
  system: string
  text: string
  images?: { label: string; base64: string }[]
  schema: unknown
  maxTokens: number
}

export interface JsonResult {
  json: unknown
  usage: Usage
}

export interface ClassifyResult {
  results: AIClassifyOutput[]
  usage: Usage
}

/** docs/03 §2 — every provider (incl. the fake one used in tests) implements this. */
export interface AIProvider {
  readonly id: ProviderId
  readonly model: string
  /** Model used for the folder-architect pass (may be smarter than `model`). */
  readonly organizerModel: string
  readonly supportsVision: boolean
  /** Cloud providers must never receive sensitive files (golden rule 6). */
  readonly isCloud: boolean
  /** Files per request and parallel requests (docs/03 §2). */
  readonly batchSize: number
  readonly concurrency: number
  test(): Promise<{ ok: boolean; message: string; model?: string }>
  estimate(batch: AIClassifyInput[]): { tokensIn: number; tokensOut: number; usd: number }
  classify(batch: AIClassifyInput[], signal: AbortSignal): Promise<ClassifyResult>
  /** Revision 1 passes. */
  json(req: JsonRequest, signal: AbortSignal): Promise<JsonResult>
  /** Optional asynchronous bulk mode (Anthropic Message Batches, 50% cheaper). */
  classifyMany?(
    batches: AIClassifyInput[][],
    signal: AbortSignal,
    onProgress: (done: number) => void,
  ): Promise<(ClassifyResult | Error)[]>
}

/** Thrown for 429/529/timeouts: the runner backs off and retries. */
export class RetryableError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

/** Thrown when the provider cannot be used at all (bad key, server down). Planning continues with rules. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'auth' | 'unreachable' | 'bad_response' | 'refusal' | 'other' = 'other',
  ) {
    super(message)
  }
}
