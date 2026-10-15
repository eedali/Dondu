import type { AIClassifyInput } from '@shared/types'
import { estimateRun } from './cost'
import type { AIProvider, ClassifyResult, JsonRequest, JsonResult } from './types'

export type FakeAnswer = (
  f: AIClassifyInput,
) => Partial<{ category: string; confidence: number; sensitive: boolean; suggestedName: string }>

export interface FakeItem {
  id: string
  type: string
  name: string
  kindHint: string
  location: string
}
export interface FakeUnderstanding {
  title: string
  topic: string
  kind: string
  sensitive: boolean
  keep_together?: boolean
  confidence: number
}
export interface FakeGroup {
  id: string
  line: string
  topic: string
  kind: string
}

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
  /** Simulated latency per request (honours the abort signal). */
  delayMs = 0

  private answer: FakeAnswer
  readonly organizerModel = 'fake-organizer'
  /** Revision 1 answers (override in tests). */
  understandAnswer: (item: FakeItem) => Partial<FakeUnderstanding> = () => ({})
  organizeAnswer: (group: FakeGroup) => string | undefined = () => undefined
  readonly jsonCalls: { pass: string; text: string; images: number }[] = []

  async json(req: JsonRequest, signal: AbortSignal): Promise<JsonResult> {
    await this.wait(signal)
    this.jsonCalls.push({ pass: req.pass, text: req.text, images: req.images?.length ?? 0 })
    if (this.failNext > 0) {
      this.failNext--
      throw this.failWith ?? new Error('fake failure')
    }
    const usage = {
      tokensIn: (50 * req.text.length) / 100,
      tokensOut: 300,
      cacheWrite: 0,
      cacheRead: 0,
    }
    if (req.pass === 'understand') {
      const items = req.text
        .split(/\n\n+/)
        .map((block) => {
          const get = (k: string): string =>
            new RegExp(`^${k}: (.*)$`, 'm').exec(block)?.[1]?.trim() ?? ''
          return {
            id: get('id'),
            type: get('type'),
            name: get('name'),
            kindHint: get('kind hint'),
            location: get('location'),
          }
        })
        .filter((i) => /^u_\d+$/.test(i.id))
      return {
        json: {
          results: items.map((i) => {
            const base: FakeUnderstanding = {
              title: i.name,
              topic:
                i.type === 'folder'
                  ? i.name.toLocaleLowerCase('tr-TR')
                  : i.type === 'event'
                    ? 'etkinlik'
                    : i.kindHint,
              kind: i.kindHint || 'other',
              sensitive: false,
              keep_together: i.type === 'folder' ? true : undefined,
              confidence: 0.9,
            }
            return { id: i.id, reason: `Sahte: ${i.name}`, ...base, ...this.understandAnswer(i) }
          }),
        },
        usage,
      }
    }
    const groups = [...req.text.matchAll(/^(g\d+) \| (.*)$/gm)].map((m) => ({
      id: m[1]!,
      line: m[2]!,
      topic: /topic: ([^|]*)/.exec(m[2]!)?.[1]?.trim() ?? '',
      kind: /kind: ([^|]*)/.exec(m[2]!)?.[1]?.trim() ?? '',
    }))
    const cap = (s: string): string => s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1)
    const placements = groups.map((g) => ({
      group: g.id,
      folder: this.organizeAnswer(g) ?? (cap(g.topic) || 'Diğer'),
      reason: 'Sahte yerleşim.',
    }))
    return {
      json: {
        folders: [...new Set(placements.map((p) => p.folder))].map((p) => ({
          path: p,
          purpose: '',
        })),
        placements,
      },
      usage,
    }
  }

  private async wait(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('aborted')
    if (this.delayMs)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.delayMs)
        signal.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))), {
          once: true,
        })
      })
  }

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
    if (this.delayMs)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.delayMs)
        signal.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))), {
          once: true,
        })
      })
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
