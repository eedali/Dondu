import type { Settings } from '@shared/settings'
import type {
  AIClassifyInput,
  AIClassifyOutput,
  AIEstimate,
  Category,
  FileMeta,
  FileRecord,
} from '@shared/types'
import type { Repos } from '../../db/repos'
import { classifyFile } from '../rules'
import { estimateRun, usageCost } from './cost'
import { buildInput, gateForProvider } from './input'
import { PROMPT_VERSION, taxonomyHash } from './prompt'
import { ProviderError, RetryableError, type AIProvider, type Usage } from './types'
import { abortableSleep } from './util'
import { pricesFor } from '@shared/models'

/** Which files go to the AI (docs/02 §6.3 step 2 + docs/06 ai.mode). */
export function selectForAi(
  files: FileRecord[],
  metas: Map<string, FileMeta>,
  settings: Settings,
): FileRecord[] {
  return files.filter((f) => {
    if (f.kind !== 'file' && f.kind !== 'bundle') return false
    if (f.isCloudPlaceholder || f.size === 0) return false
    const r = classifyFile(f, metas.get(f.id) ?? {}, settings)
    if (r.category === 'junk') return false
    if (settings.ai.mode === 'all') return true
    return r.confidence < settings.ai.ruleConfidenceThreshold
  })
}

export function contentKey(f: FileRecord): string {
  if (f.hashFull) return `b3:${f.hashFull}`
  if (f.hashFast) return `x3:${f.hashFast}:${f.size}`
  return `p:${f.root}/${f.relPath}:${f.mtime}:${f.size}`
}

export function cacheKey(
  f: FileRecord,
  provider: AIProvider,
  categories: Category[],
  mode: string,
): string {
  return [
    contentKey(f),
    `v${PROMPT_VERSION}`,
    provider.id,
    provider.model,
    taxonomyHash(categories),
    mode,
  ].join('|')
}

export interface AiRunDeps {
  repos: Repos
  provider: AIProvider
  settings: Settings
  categories: Category[]
}

interface Prepared {
  file: FileRecord
  input: AIClassifyInput
  key: string
  cached?: AIClassifyOutput
}

async function prepare(
  deps: AiRunDeps,
  files: FileRecord[],
  metas: Map<string, FileMeta>,
): Promise<Prepared[]> {
  const { provider, settings } = deps
  const allowed = gateForProvider(files, provider.isCloud)
  const metadataOnly = settings.ai.mode === 'metadataOnly'
  const out: Prepared[] = []
  let n = 0
  for (const f of allowed) {
    const alias = `f_${String(++n).padStart(4, '0')}`
    const input = await buildInput(alias, f, metas.get(f.id) ?? {}, settings, {
      allowImage: provider.supportsVision && !metadataOnly && f.family === 'image',
      allowExcerpt: !metadataOnly,
    })
    const key = cacheKey(f, provider, deps.categories, settings.ai.mode)
    const hit = settings.ai.cacheEnabled ? deps.repos.aiCache.get(key) : undefined
    out.push({
      file: f,
      input,
      key,
      cached: hit ? { ...(hit.result as AIClassifyOutput), id: alias } : undefined,
    })
  }
  return out
}

function chunk(items: Prepared[], size: number): Prepared[][] {
  const out: Prepared[][] = []
  let cur: Prepared[] = []
  for (const it of items) {
    // Batches with images are smaller (docs/03 §2: 6 per request).
    const limit =
      cur.some((c) => c.input.imageJpegBase64) || it.input.imageJpegBase64
        ? Math.min(6, size)
        : size
    if (cur.length >= limit) {
      out.push(cur)
      cur = []
    }
    cur.push(it)
  }
  if (cur.length) out.push(cur)
  return out
}

export async function estimateAi(
  deps: AiRunDeps,
  files: FileRecord[],
  metas: Map<string, FileMeta>,
): Promise<AIEstimate> {
  const { settings, provider } = deps
  const prepared = await prepare(deps, selectForAi(files, metas, settings), metas)
  const todo = prepared.filter((p) => !p.cached)
  const batches = chunk(todo, Math.min(settings.ai.batchSize, provider.batchSize))
  const est =
    provider.id === 'lmstudio'
      ? { tokensIn: 0, tokensOut: 0, usd: 0 }
      : estimateRun(
          todo.map((p) => p.input),
          batches.length,
          {
            imageEdge: settings.images.thumbnailMaxEdge,
            batchApi: settings.ai.anthropic.useBatchApi,
          },
        )
  // LM Studio is free, but token volume still matters for speed; estimate it for display.
  const tokens =
    provider.id === 'lmstudio'
      ? estimateRun(
          todo.map((p) => p.input),
          batches.length,
        )
      : est
  const overUsd = provider.id === 'anthropic' && est.usd > settings.ai.maxUsdPerRun
  const overTokens = tokens.tokensIn + tokens.tokensOut > settings.ai.maxTokensPerRun
  return {
    provider: provider.id,
    model: provider.model,
    files: todo.length,
    cachedFiles: prepared.length - todo.length,
    withImages: todo.filter((p) => p.input.imageJpegBase64).length,
    tokensIn: tokens.tokensIn,
    tokensOut: tokens.tokensOut,
    usd: est.usd,
    overLimit: overUsd || overTokens,
    limitReason: overUsd ? 'usd' : overTokens ? 'tokens' : undefined,
  }
}

export interface AiRunResult {
  /** fileId → classification */
  results: Map<string, AIClassifyOutput>
  summary: {
    files: number
    tokensIn: number
    tokensOut: number
    usd: number
    failedBatches: number
  }
}

/**
 * BatchRunner (docs/03 §2): batching, concurrency, exponential back-off on 429/529, cancel,
 * progress, cache writes. A failed batch never stops planning — its files keep their rule result.
 */
export async function runAi(
  deps: AiRunDeps,
  files: FileRecord[],
  metas: Map<string, FileMeta>,
  signal: AbortSignal,
  onProgress: (done: number, total: number, usd: number) => void = () => undefined,
  opts: { sleep?: (ms: number) => Promise<void>; maxAttempts?: number } = {},
): Promise<AiRunResult> {
  const { provider, settings, repos } = deps
  const sleep = opts.sleep ?? ((ms: number) => abortableSleep(ms, signal))
  const maxAttempts = opts.maxAttempts ?? 5

  const est = await estimateAi(deps, files, metas)
  if (est.overLimit) throw new ProviderError('over_limit', 'other')

  const prepared = await prepare(deps, selectForAi(files, metas, settings), metas)
  const results = new Map<string, AIClassifyOutput>()
  for (const p of prepared) if (p.cached) results.set(p.file.id, { ...p.cached, id: p.file.id })

  const todo = prepared.filter((p) => !p.cached)
  const batches = chunk(todo, Math.min(settings.ai.batchSize, provider.batchSize))
  const usage: Usage = { tokensIn: 0, tokensOut: 0, cacheWrite: 0, cacheRead: 0 }
  let failedBatches = 0
  let done = 0
  const spent = (): number =>
    provider.id === 'anthropic'
      ? usageCost(usage, settings.ai.anthropic.useBatchApi, pricesFor(provider.model))
      : 0
  onProgress(0, batches.length, 0)

  const accept = (batch: Prepared[], res: { results: AIClassifyOutput[]; usage: Usage }): void => {
    usage.tokensIn += res.usage.tokensIn
    usage.tokensOut += res.usage.tokensOut
    usage.cacheWrite += res.usage.cacheWrite
    usage.cacheRead += res.usage.cacheRead
    const byAlias = new Map(batch.map((p) => [p.input.id, p]))
    for (const r of res.results) {
      const p = byAlias.get(r.id)
      if (!p) continue
      results.set(p.file.id, { ...r, id: p.file.id })
      if (settings.ai.cacheEnabled) {
        const share = batch.length || 1
        repos.aiCache.set(
          p.key,
          { ...r, id: '' },
          Math.round(res.usage.tokensIn / share),
          Math.round(res.usage.tokensOut / share),
        )
      }
    }
    if (res.results.length < batch.length) failedBatches += res.results.length === 0 ? 1 : 0
  }

  if (settings.ai.anthropic.useBatchApi && provider.classifyMany && batches.length) {
    try {
      const outs = await provider.classifyMany(
        batches.map((b) => b.map((p) => p.input)),
        signal,
        (n) => onProgress(n, batches.length, spent()),
      )
      outs.forEach((o, i) => (o instanceof Error ? failedBatches++ : accept(batches[i]!, o)))
    } catch (e) {
      // Stopped by the user: keep whatever is cached, plan the rest with rules.
      if (!signal.aborted) throw e
    }
  } else {
    let next = 0
    let fatal: Error | null = null
    const worker = async (): Promise<void> => {
      while (next < batches.length && !fatal && !signal.aborted) {
        const batch = batches[next++]!
        for (let attempt = 1; ; attempt++) {
          try {
            accept(
              batch,
              await provider.classify(
                batch.map((p) => p.input),
                signal,
              ),
            )
            break
          } catch (e) {
            if (signal.aborted) return
            if (e instanceof ProviderError && (e.code === 'auth' || e.code === 'unreachable')) {
              fatal = e
              return
            }
            if (e instanceof RetryableError && attempt < maxAttempts) {
              await sleep(e.retryAfterMs ?? Math.min(30_000, 1000 * 2 ** (attempt - 1)))
              continue
            }
            failedBatches++
            break
          }
        }
        onProgress(++done, batches.length, spent())
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, provider.concurrency) }, worker))
    if (fatal) throw fatal
  }

  return {
    results,
    summary: {
      files: todo.length,
      tokensIn: usage.tokensIn + usage.cacheWrite + usage.cacheRead,
      tokensOut: usage.tokensOut,
      usd:
        provider.id === 'anthropic'
          ? usageCost(usage, settings.ai.anthropic.useBatchApi, pricesFor(provider.model))
          : 0,
      failedBatches,
    },
  }
}
