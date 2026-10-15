import Anthropic from '@anthropic-ai/sdk'
import type { AIClassifyInput, Category } from '@shared/types'
import type { Correction } from '../../db/repos'
import { estimateRun } from './cost'
import { parseResults, renderBatchText } from './input'
import { CLASSIFY_TOOL, systemPrompt } from './prompt'
import { ProviderError, RetryableError, type AIProvider, type ClassifyResult } from './types'

export interface AnthropicOptions {
  apiKey: string
  model: string
  effort: 'low' | 'medium'
  useBatchApi: boolean
  categories: Category[]
  corrections: Correction[]
  imageEdge: number
  /** Test hook: custom fetch for the SDK. */
  fetch?: typeof fetch
  maxRetries?: number
}

/**
 * Claude Haiku 5.5 via @anthropic-ai/sdk (docs/03 §3):
 * - no temperature/top_p/top_k (400 on this model)
 * - effort via output_config, adaptive thinking left at its default
 * - forced tool call with the classify_files JSON schema
 * - system prompt marked with cache_control
 */
export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const
  readonly supportsVision = true
  readonly isCloud = true
  readonly batchSize = 12
  readonly concurrency = 3
  readonly model: string
  private client: Anthropic
  private system: string

  constructor(private o: AnthropicOptions) {
    this.model = o.model
    this.client = new Anthropic({
      apiKey: o.apiKey,
      maxRetries: o.maxRetries ?? 2,
      timeout: 120_000,
      ...(o.fetch ? { fetch: o.fetch } : {}),
    })
    this.system = systemPrompt(o.categories, o.corrections)
  }

  /** The request body for one batch (exported for tests and the Batch API). */
  params(batch: AIClassifyInput[]): Anthropic.MessageCreateParamsNonStreaming {
    const content: Anthropic.ContentBlockParam[] = []
    for (const f of batch) {
      if (f.imageJpegBase64) {
        content.push({ type: 'text', text: `Thumbnail for ${f.id}:` })
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: f.imageJpegBase64 },
        })
      }
    }
    content.push({
      type: 'text',
      text: `Classify these ${batch.length} files. Call classify_files once with one result per id.\n\n${renderBatchText(batch)}`,
    })
    return {
      model: this.model,
      max_tokens: 8000,
      system: [{ type: 'text', text: this.system, cache_control: { type: 'ephemeral' } }],
      tools: [CLASSIFY_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: 'tool', name: CLASSIFY_TOOL.name },
      output_config: { effort: this.o.effort },
      messages: [{ role: 'user', content }],
    }
  }

  private toResult(msg: Anthropic.Message, batch: AIClassifyInput[]): ClassifyResult {
    if (msg.stop_reason === 'refusal')
      throw new ProviderError('model declined the request', 'refusal')
    const tool = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === CLASSIFY_TOOL.name,
    )
    if (!tool) throw new ProviderError('no tool call in response', 'bad_response')
    const u = msg.usage
    return {
      results: parseResults(tool.input, new Set(batch.map((b) => b.id)), this.o.categories),
      usage: {
        tokensIn: u.input_tokens,
        tokensOut: u.output_tokens,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
      },
    }
  }

  private mapError(e: unknown): Error {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      return new ProviderError('API anahtarı geçersiz ya da yetkisiz.', 'auth')
    if (e instanceof Anthropic.RateLimitError) {
      const ra = Number(e.headers?.get?.('retry-after'))
      return new RetryableError('rate limited', Number.isFinite(ra) ? ra * 1000 : undefined)
    }
    if (e instanceof Anthropic.APIConnectionError) return new RetryableError('connection error')
    if (e instanceof Anthropic.APIError && (e.status === 529 || (e.status ?? 0) >= 500))
      return new RetryableError(`server ${e.status}`)
    if (e instanceof Anthropic.BadRequestError) return new ProviderError(e.message, 'bad_response')
    return e instanceof Error ? e : new Error(String(e))
  }

  async test(): Promise<{ ok: boolean; message: string; model?: string }> {
    try {
      const msg = await this.client.messages.create({
        model: this.model,
        max_tokens: 64,
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      })
      return { ok: true, message: 'ok', model: msg.model }
    } catch (e) {
      const err = this.mapError(e)
      return { ok: false, message: err.message }
    }
  }

  estimate(batch: AIClassifyInput[]): { tokensIn: number; tokensOut: number; usd: number } {
    const r = estimateRun(batch, 1, { imageEdge: this.o.imageEdge, batchApi: this.o.useBatchApi })
    return { tokensIn: r.tokensIn, tokensOut: r.tokensOut, usd: r.usd }
  }

  async classify(batch: AIClassifyInput[], signal: AbortSignal): Promise<ClassifyResult> {
    try {
      const msg = await this.client.messages.create(this.params(batch), { signal })
      return this.toResult(msg, batch)
    } catch (e) {
      if (e instanceof ProviderError) throw e
      throw this.mapError(e)
    }
  }

  /** Message Batches API: one async job for all batches, ~50% cheaper (docs/03 §3). */
  async classifyMany(
    batches: AIClassifyInput[][],
    signal: AbortSignal,
    onProgress: (done: number) => void,
  ): Promise<(ClassifyResult | Error)[]> {
    if (!this.o.useBatchApi) throw new Error('batch api disabled')
    const job = await this.client.messages.batches
      .create({ requests: batches.map((b, i) => ({ custom_id: `b${i}`, params: this.params(b) })) })
      .catch((e: unknown) => {
        throw this.mapError(e)
      })
    let status = job
    while (status.processing_status !== 'ended') {
      if (signal.aborted) {
        await this.client.messages.batches.cancel(job.id).catch(() => undefined)
        throw new Error('aborted')
      }
      await new Promise((r) => setTimeout(r, 5000))
      status = await this.client.messages.batches.retrieve(job.id)
      onProgress(status.request_counts.succeeded + status.request_counts.errored)
    }
    const out: (ClassifyResult | Error)[] = batches.map(() => new Error('missing'))
    for await (const r of await this.client.messages.batches.results(job.id)) {
      const idx = Number(r.custom_id.slice(1))
      const batch = batches[idx]
      if (!batch) continue
      if (r.result.type === 'succeeded') {
        try {
          out[idx] = this.toResult(r.result.message, batch)
        } catch (e) {
          out[idx] = e as Error
        }
      } else out[idx] = new Error(`batch request ${r.result.type}`)
    }
    return out
  }
}
