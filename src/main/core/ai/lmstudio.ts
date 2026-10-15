import type { AIClassifyInput, Category } from '@shared/types'
import type { Correction } from '../../db/repos'
import { parseResults, renderBatchText } from './input'
import { CLASSIFY_TOOL, systemPrompt } from './prompt'
import { ProviderError, RetryableError, type AIProvider, type ClassifyResult } from './types'

export interface LmStudioOptions {
  baseUrl: string
  model: string
  vision: boolean
  categories: Category[]
  corrections: Correction[]
  fetch?: typeof fetch
  timeoutMs?: number
}

/** Local LM Studio via its OpenAI-compatible endpoint, plain fetch (docs/03 §4). */
export class LmStudioProvider implements AIProvider {
  readonly id = 'lmstudio' as const
  readonly isCloud = false
  readonly batchSize = 6
  readonly concurrency = 1
  readonly model: string
  readonly supportsVision: boolean
  private f: typeof fetch
  private system: string

  constructor(private o: LmStudioOptions) {
    this.model = o.model
    this.supportsVision = o.vision
    this.f = o.fetch ?? fetch
    this.system = systemPrompt(o.categories, o.corrections)
  }

  private url(p: string): string {
    return `${this.o.baseUrl.replace(/\/+$/, '')}${p}`
  }

  private async req(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 120_000)
    signal?.addEventListener('abort', () => ctl.abort(), { once: true })
    try {
      return await this.f(this.url(path), { ...init, signal: ctl.signal })
    } catch (e) {
      if (signal?.aborted) throw e
      if (ctl.signal.aborted) throw new RetryableError('LM Studio did not answer in time')
      throw new ProviderError(
        "LM Studio'da sunucu başlatılmamış (Developer → Start Server) ya da adres yanlış.",
        'unreachable',
      )
    } finally {
      clearTimeout(timer)
    }
  }

  async listModels(): Promise<string[]> {
    const r = await this.req('/models', { method: 'GET' })
    if (!r.ok) throw new ProviderError(`LM Studio /models: HTTP ${r.status}`, 'unreachable')
    const j = (await r.json()) as { data?: { id: string }[] }
    return (j.data ?? []).map((m) => m.id)
  }

  async test(): Promise<{ ok: boolean; message: string; model?: string }> {
    try {
      const models = await this.listModels()
      if (!models.length) return { ok: false, message: 'LM Studio çalışıyor ama yüklü model yok.' }
      if (this.model && !models.includes(this.model))
        return { ok: false, message: `Model bulunamadı: ${this.model}` }
      return { ok: true, message: 'ok', model: this.model || models[0] }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }

  estimate(): { tokensIn: number; tokensOut: number; usd: number } {
    return { tokensIn: 0, tokensOut: 0, usd: 0 }
  }

  body(batch: AIClassifyInput[]): Record<string, unknown> {
    const userContent: unknown[] = [
      {
        type: 'text',
        text: `Classify these ${batch.length} files. Answer with JSON {"results": [...]}, one result per id.\n\n${renderBatchText(batch)}`,
      },
    ]
    if (this.supportsVision) {
      for (const f of batch)
        if (f.imageJpegBase64)
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${f.imageJpegBase64}` },
          })
    }
    return {
      model: this.model,
      messages: [
        { role: 'system', content: this.system },
        {
          role: 'user',
          content: this.supportsVision ? userContent : (userContent[0] as { text: string }).text,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: CLASSIFY_TOOL.name, strict: true, schema: CLASSIFY_TOOL.input_schema },
      },
      stream: false,
    }
  }

  async classify(batch: AIClassifyInput[], signal: AbortSignal): Promise<ClassifyResult> {
    const r = await this.req(
      '/chat/completions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(this.body(batch)),
      },
      signal,
    )
    if (r.status === 429 || r.status >= 500) throw new RetryableError(`LM Studio HTTP ${r.status}`)
    if (!r.ok)
      throw new ProviderError(
        `LM Studio HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`,
        'bad_response',
      )
    const j = (await r.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const text = j.choices?.[0]?.message?.content ?? ''
    let parsed: unknown
    try {
      parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    } catch {
      throw new ProviderError('LM Studio yanıtı geçerli JSON değil.', 'bad_response')
    }
    return {
      results: parseResults(parsed, new Set(batch.map((b) => b.id)), this.o.categories),
      usage: {
        tokensIn: j.usage?.prompt_tokens ?? 0,
        tokensOut: j.usage?.completion_tokens ?? 0,
        cacheWrite: 0,
        cacheRead: 0,
      },
    }
  }
}
