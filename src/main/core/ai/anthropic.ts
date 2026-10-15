import Anthropic from '@anthropic-ai/sdk'
import { presetFor, pricesFor } from '@shared/models'
import type { AIClassifyInput, Category } from '@shared/types'
import type { Correction } from '../../db/repos'
import { estimateRun } from './cost'
import { parseResults, renderBatchText } from './input'
import { CLASSIFY_TOOL, systemPrompt } from './prompt'
import {
  ProviderError,
  RetryableError,
  type AIProvider,
  type ClassifyResult,
  type Usage,
} from './types'
import { abortableSleep, toStructuredSchema } from './util'

export interface AnthropicOptions {
  apiKey: string
  /** Model that looks at files (cheap, vision). */
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

/** The subset of a (beta) Message we read; both endpoints return this shape. */
interface MessageLike {
  model: string
  content: { type: string; text?: string }[]
  stop_reason: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number | null
    cache_read_input_tokens?: number | null
  }
}

export interface JsonCall {
  model: string
  effort: 'low' | 'medium' | 'high'
  system: string
  content: Anthropic.ContentBlockParam[]
  schema: unknown
  maxTokens: number
}

/**
 * Claude via @anthropic-ai/sdk (docs/03 §3, revision 2):
 * - any Claude model (Haiku 5.5 default; Sonnet 5.5 / Opus 5.5 selectable)
 * - JSON through structured outputs (`output_config.format`), which every current model accepts —
 *   forced tool_choice is rejected by Sonnet 5.5 and Opus 5.5
 * - no temperature/top_p/top_k; effort always set explicitly (defaults differ per model)
 * - system prompt marked with cache_control
 * - Sonnet/Opus: server-side refusal fallback (`fallbacks: "default"`)
 */
export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const
  readonly supportsVision = true
  readonly isCloud = true
  readonly batchSize = 12
  readonly concurrency = 3
  readonly model: string
  protected client: Anthropic
  private system: string

  constructor(protected o: AnthropicOptions) {
    this.model = o.model
    this.client = new Anthropic({
      apiKey: o.apiKey,
      maxRetries: o.maxRetries ?? 2,
      timeout: 120_000,
      ...(o.fetch ? { fetch: o.fetch } : {}),
    })
    this.system = systemPrompt(o.categories, o.corrections)
  }

  /** Request body for a JSON-returning call (exported shape for tests and the Batch API). */
  jsonParams(c: JsonCall): Anthropic.MessageCreateParamsNonStreaming {
    return {
      model: c.model,
      max_tokens: c.maxTokens,
      system: [{ type: 'text', text: c.system, cache_control: { type: 'ephemeral' } }],
      output_config: {
        effort: c.effort,
        format: {
          type: 'json_schema',
          schema: toStructuredSchema(c.schema) as Record<string, unknown>,
        },
      },
      messages: [{ role: 'user', content: c.content }],
    }
  }

  /** Classification request for one batch of files. */
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
      text: `Classify these ${batch.length} files. Return JSON {"results": [...]} with one result per id.\n\n${renderBatchText(batch)}`,
    })
    return this.jsonParams({
      model: this.model,
      effort: this.o.effort,
      system: this.system,
      content,
      schema: CLASSIFY_TOOL.input_schema,
      maxTokens: 8000,
    })
  }

  /** Sends one request; Sonnet/Opus go through the beta endpoint with the refusal fallback. */
  protected async send(
    params: Anthropic.MessageCreateParamsNonStreaming,
    signal: AbortSignal,
  ): Promise<MessageLike> {
    try {
      if (presetFor(params.model)?.fallback) {
        return (await this.client.beta.messages.create(
          {
            ...(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming),
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          },
          { signal },
        )) as unknown as MessageLike
      }
      return (await this.client.messages.create(params, { signal })) as unknown as MessageLike
    } catch (e) {
      throw this.mapError(e)
    }
  }

  /** Extracts and parses the JSON answer; throws a ProviderError on refusal or bad output. */
  protected parseJson(msg: MessageLike): { json: unknown; usage: Usage } {
    if (msg.stop_reason === 'refusal')
      throw new ProviderError('model declined the request', 'refusal')
    if (msg.stop_reason === 'max_tokens')
      throw new ProviderError('answer was cut off', 'bad_response')
    const text = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new ProviderError('response is not valid JSON', 'bad_response')
    }
    const u = msg.usage
    return {
      json,
      usage: {
        tokensIn: u.input_tokens,
        tokensOut: u.output_tokens,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
      },
    }
  }

  private toResult(msg: MessageLike, batch: AIClassifyInput[]): ClassifyResult {
    const { json, usage } = this.parseJson(msg)
    return {
      results: parseResults(json, new Set(batch.map((b) => b.id)), this.o.categories),
      usage,
    }
  }

  protected mapError(e: unknown): Error {
    if (e instanceof ProviderError || e instanceof RetryableError) return e
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      return new ProviderError('API anahtarı geçersiz ya da bu modele erişimi yok.', 'auth')
    if (e instanceof Anthropic.NotFoundError)
      return new ProviderError(`Model bulunamadı ya da bu anahtarla kullanılamıyor.`, 'auth')
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
        max_tokens: 256,
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      })
      return { ok: true, message: 'ok', model: msg.model }
    } catch (e) {
      return { ok: false, message: this.mapError(e).message }
    }
  }

  /** Models this key can use (Models API), for the Settings picker. */
  async listModels(): Promise<{ id: string; name: string; vision: boolean }[]> {
    const out: { id: string; name: string; vision: boolean }[] = []
    for await (const m of this.client.models.list()) {
      out.push({ id: m.id, name: m.display_name, vision: !!m.capabilities?.image_input?.supported })
    }
    return out
  }

  estimate(batch: AIClassifyInput[]): { tokensIn: number; tokensOut: number; usd: number } {
    const r = estimateRun(batch, 1, {
      imageEdge: this.o.imageEdge,
      batchApi: this.o.useBatchApi,
      prices: pricesFor(this.model),
    })
    return { tokensIn: r.tokensIn, tokensOut: r.tokensOut, usd: r.usd }
  }

  async classify(batch: AIClassifyInput[], signal: AbortSignal): Promise<ClassifyResult> {
    return this.toResult(await this.send(this.params(batch), signal), batch)
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
      await abortableSleep(5000, signal)
      if (signal.aborted) {
        await this.client.messages.batches.cancel(job.id).catch(() => undefined)
        throw new Error('aborted')
      }
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
          out[idx] = this.toResult(r.result.message as unknown as MessageLike, batch)
        } catch (e) {
          out[idx] = e as Error
        }
      } else out[idx] = new Error(`batch request ${r.result.type}`)
    }
    return out
  }
}
