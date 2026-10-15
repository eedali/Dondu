import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../../src/shared/categories'
import { defaultSettings } from '../../src/shared/settings'
import type { AIClassifyInput } from '../../src/shared/types'
import { AnthropicProvider } from '../../src/main/core/ai/anthropic'
import { estimateRun, imageTokens, usageCost } from '../../src/main/core/ai/cost'
import { FakeProvider } from '../../src/main/core/ai/fake'
import { gateForProvider, normalizeCategory, parseResults } from '../../src/main/core/ai/input'
import { LmStudioProvider } from '../../src/main/core/ai/lmstudio'
import { PROMPT_VERSION, systemPrompt } from '../../src/main/core/ai/prompt'
import { estimateAi, runAi } from '../../src/main/core/ai/runner'
import { ProviderError, RetryableError } from '../../src/main/core/ai/types'
import { buildPlan } from '../../src/main/core/planner'
import { scanFixture } from '../helpers/scan'

const input = (id: string, p: Partial<AIClassifyInput> = {}): AIClassifyInput => ({
  id,
  name: `${id}.pdf`,
  ext: 'pdf',
  sizeBytes: 1000,
  mtimeIso: '2024-01-01',
  kind: 'file',
  metaSummary: 'document, 1 pages',
  ...p,
})

describe('cost estimator (docs/03 §7)', () => {
  it('keeps a 50-file mixed desktop under one cent with Haiku 5.5', () => {
    const files: AIClassifyInput[] = []
    for (let i = 0; i < 20; i++) files.push(input(`img${i}`, { imageJpegBase64: 'x' }))
    for (let i = 0; i < 12; i++) files.push(input(`doc${i}`, { textExcerpt: 'a'.repeat(1500) }))
    for (let i = 0; i < 18; i++) files.push(input(`misc${i}`))
    const r = estimateRun(files, 5)
    expect(r.usd).toBeGreaterThan(0.002)
    expect(r.usd).toBeLessThan(0.01)
    expect(estimateRun(files, 5, { batchApi: true }).usd).toBeCloseTo(r.usd / 2, 6)
  })
  it('image tokens ≈ w×h/750 at the sent size', () => {
    expect(imageTokens(768, 576, 768)).toBe(590)
    expect(imageTokens(4032, 3024, 768)).toBe(590)
  })
  it('computes real cost from usage', () => {
    expect(
      usageCost({ tokensIn: 1_000_000, tokensOut: 0, cacheWrite: 0, cacheRead: 0 }),
    ).toBeCloseTo(0.1)
  })
})

describe('prompt', () => {
  it('fills categories and examples, has a version', () => {
    const s = systemPrompt(DEFAULT_CATEGORIES, [
      {
        ext: 'pdf',
        namePattern: 'lasku #',
        oldCategory: 'docs_other',
        newCategory: 'docs_invoice',
        createdAt: 0,
      },
    ])
    expect(PROMPT_VERSION).toBeGreaterThanOrEqual(1)
    expect(s).toContain('`docs_invoice`')
    expect(s).toContain('lasku #')
    expect(s).not.toContain('{{CATEGORIES}}')
    expect(s).not.toContain('PROMPT_VERSION')
  })
})

describe('output validation', () => {
  it('keeps only known ids, once, and normalises categories', () => {
    const out = parseResults(
      {
        results: [
          {
            id: 'f_0001',
            category: 'docs_invoice',
            confidence: 0.9,
            sensitive: false,
            reason: 'x',
          },
          { id: 'f_0001', category: 'photos', confidence: 0.9, sensitive: false, reason: 'dup' },
          {
            id: 'f_9999',
            category: 'photos',
            confidence: 0.9,
            sensitive: false,
            reason: 'unknown id',
          },
          {
            id: 'f_0002',
            category: 'Fotoğraflar',
            confidence: 0.8,
            sensitive: false,
            reason: 'by name',
          },
          {
            id: 'f_0003',
            category: 'docs-invoice',
            confidence: 2,
            sensitive: false,
            reason: 'bad conf',
          },
        ],
      },
      new Set(['f_0001', 'f_0002', 'f_0003']),
      DEFAULT_CATEGORIES,
    )
    expect(out.map((o) => [o.id, o.category])).toEqual([
      ['f_0001', 'docs_invoice'],
      ['f_0002', 'photos'],
    ])
    expect(normalizeCategory('docs-invoice', DEFAULT_CATEGORIES)).toBe('docs_invoice')
    expect(normalizeCategory('something random', DEFAULT_CATEGORIES)).toBe('uncertain')
  })
})

describe('privacy gate', () => {
  it('cloud providers never get sensitive files; local ones may', () => {
    const files = [{ sensitive: true }, { sensitive: false }]
    expect(gateForProvider(files, true)).toHaveLength(1)
    expect(gateForProvider(files, false)).toHaveLength(2)
  })

  it('a full AI run sends no sensitive file to the cloud', async () => {
    const { repos, sessionId, settings, info } = await scanFixture()
    settings.ai.mode = 'all'
    const provider = new FakeProvider({ cloud: true })
    await runAi(
      { repos, provider, settings, categories: DEFAULT_CATEGORIES },
      repos.files.bySession(sessionId),
      repos.files.metaBySession(sessionId),
      new AbortController().signal,
    )
    const sent = provider.received.flat().map((i) => i.name)
    expect(sent.length).toBeGreaterThan(20)
    for (const s of info.sensitive) expect(sent).not.toContain(s.split('/').pop())
    // Local provider gets them.
    const local = new FakeProvider({ cloud: false })
    settings.ai.cacheEnabled = false
    await runAi(
      { repos, provider: local, settings, categories: DEFAULT_CATEGORIES },
      repos.files.bySession(sessionId),
      repos.files.metaBySession(sessionId),
      new AbortController().signal,
    )
    expect(local.received.flat().map((i) => i.name)).toContain('parolalar.txt')
  })
})

describe('BatchRunner', () => {
  it('caches results: the second run costs nothing', async () => {
    const { repos, sessionId, settings } = await scanFixture()
    const provider = new FakeProvider({
      answer: () => ({ category: 'docs_work', confidence: 0.95 }),
    })
    const deps = { repos, provider, settings, categories: DEFAULT_CATEGORIES }
    const files = repos.files.bySession(sessionId)
    const metas = repos.files.metaBySession(sessionId)
    const first = await runAi(deps, files, metas, new AbortController().signal)
    expect(first.results.size).toBeGreaterThan(0)
    const calls = provider.received.length
    const est = await estimateAi(deps, files, metas)
    expect(est.files).toBe(0)
    expect(est.cachedFiles).toBe(first.results.size)
    const second = await runAi(deps, files, metas, new AbortController().signal)
    expect(provider.received.length).toBe(calls)
    expect(second.results.size).toBe(first.results.size)
    expect(second.summary.tokensIn).toBe(0)
  })

  it('backs off on 429/529 and retries; gives up on a batch after max attempts', async () => {
    const { repos, sessionId, settings } = await scanFixture()
    settings.ai.cacheEnabled = false
    const provider = new FakeProvider()
    provider.failNext = 2
    provider.failWith = new RetryableError('rate limited', 5)
    const sleeps: number[] = []
    const res = await runAi(
      { repos, provider, settings, categories: DEFAULT_CATEGORIES },
      repos.files.bySession(sessionId),
      repos.files.metaBySession(sessionId),
      new AbortController().signal,
      undefined,
      { sleep: async (ms) => void sleeps.push(ms) },
    )
    expect(sleeps).toEqual([5, 5])
    expect(res.summary.failedBatches).toBe(0)
  })

  it('stops the AI step on an auth error (planning continues with rules)', async () => {
    const { repos, sessionId, settings } = await scanFixture()
    settings.ai.cacheEnabled = false
    const provider = new FakeProvider()
    provider.failNext = 100
    provider.failWith = new ProviderError('bad key', 'auth')
    await expect(
      runAi(
        { repos, provider, settings, categories: DEFAULT_CATEGORIES },
        repos.files.bySession(sessionId),
        repos.files.metaBySession(sessionId),
        new AbortController().signal,
      ),
    ).rejects.toThrow('bad key')
  })

  it('refuses to start when the estimate is over the limit', async () => {
    const { repos, sessionId, settings } = await scanFixture()
    settings.ai.mode = 'all'
    settings.ai.maxUsdPerRun = 0.000001
    const provider = new FakeProvider()
    const deps = { repos, provider, settings, categories: DEFAULT_CATEGORIES }
    const est = await estimateAi(
      deps,
      repos.files.bySession(sessionId),
      repos.files.metaBySession(sessionId),
    )
    expect(est.overLimit).toBe(true)
    expect(est.limitReason).toBe('usd')
    await expect(
      runAi(
        deps,
        repos.files.bySession(sessionId),
        repos.files.metaBySession(sessionId),
        new AbortController().signal,
      ),
    ).rejects.toThrow('over_limit')
    expect(provider.received.length).toBe(0)
  })

  it('AI results feed the planner (source = ai)', async () => {
    const { repos, sessionId, settings } = await scanFixture()
    const files = repos.files.bySession(sessionId)
    const metas = repos.files.metaBySession(sessionId)
    const provider = new FakeProvider({
      answer: (f) =>
        f.name === 'Untitled.docx' ? { category: 'docs_education', confidence: 0.93 } : {},
    })
    const ai = await runAi(
      { repos, provider, settings, categories: DEFAULT_CATEGORIES },
      files,
      metas,
      new AbortController().signal,
    )
    const plan = buildPlan({
      planId: 'p',
      sessionId,
      roots: repos.sessions.get(sessionId)!.roots,
      files,
      metas,
      settings,
      categories: DEFAULT_CATEGORIES,
      ai: ai.results,
    })
    const it = plan.items.find((i) => i.sourcePath.endsWith('Untitled.docx'))!
    expect(it.category).toBe('docs_education')
    expect(it.source).toBe('ai')
    expect(it.enabled).toBe(true)
  })
})

function mockFetch(
  handler: (
    url: string,
    body: unknown,
  ) => { status: number; json?: unknown; headers?: Record<string, string> },
): { fetch: typeof fetch; calls: { url: string; body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = []
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url: u, body })
    const r = handler(u, body)
    return new Response(JSON.stringify(r.json ?? {}), {
      status: r.status,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    })
  }) as typeof fetch
  return { fetch: f, calls }
}

describe('AnthropicProvider (mocked HTTP)', () => {
  const ok = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    stop_reason: 'tool_use',
    stop_sequence: null,
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      {
        type: 'tool_use',
        id: 'tu_1',
        name: 'classify_files',
        input: {
          results: [
            {
              id: 'f_0001',
              category: 'docs_invoice',
              confidence: 0.92,
              sensitive: false,
              reason: 'Fatura.',
            },
          ],
        },
      },
    ],
    usage: {
      input_tokens: 800,
      output_tokens: 90,
      cache_creation_input_tokens: 1200,
      cache_read_input_tokens: 0,
    },
  }

  const make = (f: typeof fetch): AnthropicProvider =>
    new AnthropicProvider({
      apiKey: 'sk-test',
      model: 'claude-haiku-5-5',
      effort: 'low',
      useBatchApi: false,
      categories: DEFAULT_CATEGORIES,
      corrections: [],
      imageEdge: 768,
      fetch: f,
      maxRetries: 0,
    })

  it('sends a Haiku 5.5-compatible request and reads the tool call', async () => {
    const m = mockFetch(() => ({ status: 200, json: ok }))
    const p = make(m.fetch)
    const res = await p.classify(
      [input('f_0001', { imageJpegBase64: 'AAAA' })],
      new AbortController().signal,
    )
    const body = m.calls[0]!.body as Record<string, unknown>
    expect(m.calls[0]!.url).toContain('/v1/messages')
    expect(body['model']).toBe('claude-haiku-5-5')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(body).not.toHaveProperty('top_k')
    expect(body['output_config']).toEqual({ effort: 'low' })
    expect(body['tool_choice']).toEqual({ type: 'tool', name: 'classify_files' })
    const system = body['system'] as { cache_control?: unknown }[]
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' })
    const content = (body['messages'] as { content: { type: string }[] }[])[0]!.content
    expect(content.some((c) => c.type === 'image')).toBe(true)
    expect(res.results[0]!.category).toBe('docs_invoice')
    expect(res.usage).toEqual({ tokensIn: 800, tokensOut: 90, cacheWrite: 1200, cacheRead: 0 })
  })

  it('maps 429/529 to retryable and 401 to an auth error', async () => {
    const p429 = make(
      mockFetch(() => ({
        status: 429,
        json: { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } },
        headers: { 'retry-after': '2' },
      })).fetch,
    )
    await expect(
      p429.classify([input('f_0001')], new AbortController().signal),
    ).rejects.toBeInstanceOf(RetryableError)
    const p529 = make(
      mockFetch(() => ({
        status: 529,
        json: { type: 'error', error: { type: 'overloaded_error', message: 'busy' } },
      })).fetch,
    )
    await expect(
      p529.classify([input('f_0001')], new AbortController().signal),
    ).rejects.toBeInstanceOf(RetryableError)
    const p401 = make(
      mockFetch(() => ({
        status: 401,
        json: { type: 'error', error: { type: 'authentication_error', message: 'no' } },
      })).fetch,
    )
    const err = await p401.classify([input('f_0001')], new AbortController().signal).catch((e) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).code).toBe('auth')
  })
})

describe('LmStudioProvider (mocked HTTP)', () => {
  it('lists models, sends json_schema, parses the answer', async () => {
    const m = mockFetch((url) =>
      url.endsWith('/models')
        ? { status: 200, json: { data: [{ id: 'gemma-3-12b' }] } }
        : {
            status: 200,
            json: {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      results: [
                        {
                          id: 'f_0001',
                          category: 'Fatura',
                          confidence: 0.7,
                          sensitive: false,
                          reason: 'x',
                        },
                      ],
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 300, completion_tokens: 40 },
            },
          },
    )
    const p = new LmStudioProvider({
      baseUrl: 'http://localhost:1234/v1/',
      model: 'gemma-3-12b',
      vision: false,
      categories: DEFAULT_CATEGORIES,
      corrections: [],
      fetch: m.fetch,
    })
    expect((await p.test()).ok).toBe(true)
    const r = await p.classify([input('f_0001')], new AbortController().signal)
    const body = m.calls[1]!.body as { response_format: { type: string } }
    expect(m.calls[1]!.url).toBe('http://localhost:1234/v1/chat/completions')
    expect(body.response_format.type).toBe('json_schema')
    expect(r.results[0]!.category).toBe('docs_invoice') // "Fatura" normalised to the closed list
  })

  it('explains clearly when the server is not running', async () => {
    const p = new LmStudioProvider({
      baseUrl: 'http://127.0.0.1:9',
      model: 'x',
      vision: false,
      categories: DEFAULT_CATEGORIES,
      corrections: [],
      fetch: (async () => {
        throw new TypeError('fetch failed')
      }) as typeof fetch,
    })
    const t = await p.test()
    expect(t.ok).toBe(false)
    expect(t.message).toContain('Start Server')
  })
})

describe.runIf(process.env['DONDU_LIVE_AI'] === '1' && !!process.env['ANTHROPIC_API_KEY'])(
  'live Anthropic (3 files)',
  () => {
    it('returns schema-valid results', async () => {
      const p = new AnthropicProvider({
        apiKey: process.env['ANTHROPIC_API_KEY']!,
        model: defaultSettings().ai.anthropic.model,
        effort: 'low',
        useBatchApi: false,
        categories: DEFAULT_CATEGORIES,
        corrections: [],
        imageEdge: 768,
      })
      const r = await p.classify(
        [
          input('f_0001', {
            name: 'lasku_2023_05.pdf',
            textExcerpt:
              'LASKU Helen Oy Laskun numero 55123 Eräpäivä 15.05.2023 Yhteensä 48,20 EUR',
          }),
          input('f_0002', {
            name: 'IMG_4471.HEIC',
            ext: 'heic',
            metaSummary: 'image 4032x3024, EXIF 2024-07-14 11:03, camera iPhone 13, GPS yes',
          }),
          input('f_0003', {
            name: 'Kira Sözleşmesi.pdf',
            textExcerpt: 'KİRA SÖZLEŞMESİ Kiraya veren ... Kiracı ... Başlangıç 01.09.2022',
          }),
        ],
        new AbortController().signal,
      )
      expect(r.results.map((x) => x.id).sort()).toEqual(['f_0001', 'f_0002', 'f_0003'])
      expect(r.results.find((x) => x.id === 'f_0001')!.category).toBe('docs_invoice')
    }, 120_000)
  },
)
