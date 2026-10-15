import type { AiTestResult } from '@shared/ipc'
import type { AIClassifyOutput, AIEstimate, Plan } from '@shared/types'
import { context } from '../context'
import { AnthropicProvider } from '../core/ai/anthropic'
import { LmStudioProvider } from '../core/ai/lmstudio'
import { estimateAi, runAi } from '../core/ai/runner'
import { ProviderError, type AIProvider } from '../core/ai/types'
import { log } from './log'

/** Builds the configured provider; null when AI is off or not configured. */
export function currentProvider(): AIProvider | null {
  const ctx = context()
  const s = ctx.settings.get()
  const categories = ctx.repos.categories.all()
  const corrections = s.ai.learnFromCorrections ? ctx.repos.corrections.recent(20) : []
  if (s.ai.provider === 'anthropic') {
    const apiKey = ctx.secrets.get('anthropicApiKey')
    if (!apiKey) throw new ProviderError('Anthropic API anahtarı girilmemiş.', 'auth')
    return new AnthropicProvider({
      apiKey,
      model: s.ai.anthropic.model,
      effort: s.ai.anthropic.effort,
      useBatchApi: s.ai.anthropic.useBatchApi,
      categories,
      corrections,
      imageEdge: s.images.thumbnailMaxEdge,
    })
  }
  if (s.ai.provider === 'lmstudio') {
    return new LmStudioProvider({
      baseUrl: s.ai.lmstudio.baseUrl,
      model: s.ai.lmstudio.model,
      vision: s.ai.lmstudio.vision,
      categories,
      corrections,
    })
  }
  return null
}

export async function estimateForSession(sessionId: string): Promise<AIEstimate> {
  const ctx = context()
  const provider = currentProvider()
  if (!provider)
    return {
      provider: 'none',
      files: 0,
      cachedFiles: 0,
      withImages: 0,
      tokensIn: 0,
      tokensOut: 0,
      usd: 0,
      overLimit: false,
    }
  return estimateAi(
    {
      repos: ctx.repos,
      provider,
      settings: ctx.settings.get(),
      categories: ctx.repos.categories.all(),
    },
    ctx.repos.files.bySession(sessionId),
    ctx.repos.files.metaBySession(sessionId),
  )
}

export async function runAiForSession(
  sessionId: string,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<{ results: Map<string, AIClassifyOutput>; summary: Plan['summary']['ai'] }> {
  const ctx = context()
  const provider = currentProvider()
  if (!provider) return { results: new Map(), summary: undefined }
  const res = await runAi(
    {
      repos: ctx.repos,
      provider,
      settings: ctx.settings.get(),
      categories: ctx.repos.categories.all(),
    },
    ctx.repos.files.bySession(sessionId),
    ctx.repos.files.metaBySession(sessionId),
    signal,
    onProgress,
  )
  // AI may flag a file as sensitive (e.g. an ID photo): from now on it stays local.
  for (const [fileId, r] of res.results)
    if (r.sensitive)
      ctx.repos.files.update(fileId, { sensitive: true, sensitiveReason: 'yapay zekâ işaretledi' })
  log.info(
    `ai ${provider.id}/${provider.model} files=${res.summary.files} in=${res.summary.tokensIn} out=${res.summary.tokensOut} usd=${res.summary.usd.toFixed(4)} failedBatches=${res.summary.failedBatches}`,
  )
  return { results: res.results, summary: res.summary }
}

export async function testProvider(): Promise<AiTestResult> {
  try {
    const p = currentProvider()
    if (!p) return { ok: false, message: 'no_provider' }
    return await p.test()
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function listLmStudioModels(): Promise<string[]> {
  const s = context().settings.get()
  const p = new LmStudioProvider({
    baseUrl: s.ai.lmstudio.baseUrl,
    model: '',
    vision: false,
    categories: [],
    corrections: [],
  })
  return p.listModels()
}
