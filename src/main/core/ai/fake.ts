import type { AIClassifyInput } from '@shared/types'
import { estimateRun } from './cost'
import type { AIProvider, ClassifyResult } from './types'

export type FakeAnswer = (
  f: AIClassifyInput,
) => Partial<{ category: string; confidence: number; sensitive: boolean; suggestedName: string }>

/** Deterministic provider for tests (docs/03 §2). Records every batch it receives. */
export class FakeProvider implements AIProvider {
  readonly id: 'anthropic' | 'lmstudio'
  readonly model = 'fake-model'
  readonly supportsVision = true
  readonly batchSize: number
  readonly concurrency = 2
  readonly isCloud: boolean
  readonly received: AIClassifyInput[][] = []
  failNext = 0
  failWith: Error | null = null

  private answer: FakeAnswer

  constructor(opts: { cloud?: boolean; batchSize?: number; answer?: FakeAnswer } = {}) {
    this.isCloud = opts.cloud ?? true
    this.id = this.isCloud ? 'anthropic' : 'lmstudio'
    this.batchSize = opts.batchSize ?? 12
    this.answer = opts.answer ?? (() => ({}))
  }

  async test(): Promise<{ ok: boolean; message: string; model?: string }> {
    return { ok: true, message: 'ok', model: this.model }
  }

  estimate(batch: AIClassifyInput[]): { tokensIn: number; tokensOut: number; usd: number } {
    const r = estimateRun(batch, 1)
    return { tokensIn: r.tokensIn, tokensOut: r.tokensOut, usd: r.usd }
  }

  async classify(batch: AIClassifyInput[], signal: AbortSignal): Promise<ClassifyResult> {
    if (signal.aborted) throw new Error('aborted')
    this.received.push(batch)
    if (this.failNext > 0) {
      this.failNext--
      throw this.failWith ?? new Error('fake failure')
    }
    return {
      results: batch.map((f) => {
        const a = this.answer(f)
        return {
          id: f.id,
          category: a.category ?? 'docs_other',
          confidence: a.confidence ?? 0.9,
          sensitive: a.sensitive ?? false,
          suggestedName: a.suggestedName,
          reason: `Sahte sınıflandırma: ${f.name}`,
        }
      }),
      usage: {
        tokensIn: 100 * batch.length,
        tokensOut: 50 * batch.length,
        cacheWrite: 0,
        cacheRead: 0,
      },
    }
  }
}
