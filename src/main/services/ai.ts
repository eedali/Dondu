import type { AiTestResult } from '@shared/ipc'
import type { AIClassifyOutput, AIEstimate, Plan } from '@shared/types'
import { context } from '../context'
import { app } from 'electron'
import { AnthropicProvider } from '../core/ai/anthropic'
import { FakeProvider } from '../core/ai/fake'
import { LmStudioProvider } from '../core/ai/lmstudio'
import { estimateAi, runAi } from '../core/ai/runner'
import { estimateTopicAi, runTopicAi } from '../core/ai/topic'
import { organizeWithRules, type Organization } from '../core/organize'
import { ProviderError, type AIProvider } from '../core/ai/types'
import { log } from './log'

/** Builds the configured provider; null when AI is off or not configured. */
export function currentProvider(): AIProvider | null {
  const ctx = context()
  const s = ctx.settings.get()
  const categories = ctx.repos.categories.all()
  const corrections = s.ai.learnFromCorrections ? ctx.repos.corrections.recent(20) : []
  // Dev tooling: a slow, free, deterministic provider for UI work (never in packaged builds).
  if (!app.isPackaged && process.env['DONDU_FAKE_AI']) {
    const fake = new FakeProvider({ batchSize: 4 })
    fake.delayMs = Number(process.env['DONDU_FAKE_AI']) || 800
    return fake
  }
  if (s.ai.provider === 'anthropic') {
    const apiKey = ctx.secrets.get('anthropicApiKey')
    if (!apiKey) throw new ProviderError('Anthropic API anahtarı girilmemiş.', 'auth')
    return new AnthropicProvider({
      apiKey,
      model: s.ai.anthropic.model,
      organizerModel: s.ai.anthropic.organizerModel,
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
  const settings = ctx.settings.get()
  const files = ctx.repos.files.bySession(sessionId)
  const metas = ctx.repos.files.metaBySession(sessionId)
  if (settings.organize.style === 'topic')
    return estimateTopicAi(
      { repos: ctx.repos, provider, settings },
      organizeWithRules(files, metas, settings),
      files,
      metas,
    )
  return estimateAi(
    { repos: ctx.repos, provider, settings, categories: ctx.repos.categories.all() },
    files,
    metas,
  )
}

/** Revision 1: understand units, then design the folder tree (two AI passes). */
export async function runTopicForSession(
  sessionId: string,
  signal: AbortSignal,
  onProgress: (phase: 'ai' | 'organize', done: number, total: number, usd: number) => void,
): Promise<{ organization: Organization; summary: Plan['summary']['ai'] } | null> {
  const ctx = context()
  const provider = currentProvider()
  if (!provider) return null
  const settings = ctx.settings.get()
  const files = ctx.repos.files.bySession(sessionId)
  const metas = ctx.repos.files.metaBySession(sessionId)
  const res = await runTopicAi(
    { repos: ctx.repos, provider, settings },
    organizeWithRules(files, metas, settings),
    files,
    metas,
    signal,
    onProgress,
  )
  // AI may flag a file as sensitive (e.g. an ID photo): from now on it stays local.
  for (const p of res.organization.placements.values()) {
    const u = res.organization.units.get(p.unitId)
    if (p.sensitive && u?.type === 'file')
      ctx.repos.files.update(u.memberIds[0]!, {
        sensitive: true,
        sensitiveReason: 'yapay zekâ işaretledi',
      })
  }
  log.info(
    `topic ai ${provider.id}/${provider.model}+${provider.organizerModel} units=${res.summary.files} in=${res.summary.tokensIn} out=${res.summary.tokensOut} usd=${res.summary.usd.toFixed(4)} failed=${res.summary.failedBatches}`,
  )
  return res
}

export async function runAiForSession(
  sessionId: string,
  signal: AbortSignal,
  onProgress: (done: number, total: number, usd: number) => void,
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

export async function listAnthropicModels(): Promise<
  { id: string; name: string; vision: boolean }[]
> {
  const ctx = context()
  const apiKey = ctx.secrets.get('anthropicApiKey')
  if (!apiKey) throw new Error('Önce API anahtarını kaydedin.')
  const s = ctx.settings.get()
  const p = new AnthropicProvider({
    apiKey,
    model: s.ai.anthropic.model,
    effort: 'low',
    useBatchApi: false,
    categories: [],
    corrections: [],
    imageEdge: s.images.thumbnailMaxEdge,
  })
  return p.listModels()
}
