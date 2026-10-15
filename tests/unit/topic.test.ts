import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../src/shared/settings'
import { AnthropicProvider } from '../../src/main/core/ai/anthropic'
import { FakeProvider } from '../../src/main/core/ai/fake'
import { cleanFolder, estimateTopicAi, runTopicAi } from '../../src/main/core/ai/topic'
import { organizeWithRules } from '../../src/main/core/organize'
import { planFromSession } from '../../src/main/core/planner/session'
import { DEFAULT_CATEGORIES } from '../../src/shared/categories'
import { scanFixture, type ScannedFixture } from '../helpers/scan'

const rel = (p: string, root: string): string =>
  path.relative(root, p).split(path.sep).join('/').normalize('NFC')

/** A fake "smart" provider that understands the fixture like a person would. */
function weddingAwareProvider(): FakeProvider {
  const p = new FakeProvider({ cloud: true, batchSize: 12 })
  p.understandAnswer = (i) => {
    if (i.type === 'event') return { title: 'Düğün — Haziran 2023', topic: 'düğün', kind: 'photo' }
    if (i.name === 'Python Kursu')
      return { title: 'Python kursu', topic: 'python kursu', kind: 'video' }
    if (i.name === 'kenney_platformer-pack')
      return { title: 'Kenney asset paketi', topic: 'oyun geliştirme', kind: 'game_asset' }
    if (i.name === 'retro sfx')
      return { title: 'Retro ses efektleri', topic: 'oyun geliştirme', kind: 'sound_effect' }
    if (i.name === 'Masaüstü Eski') return { keep_together: false }
    if (/fatura|lasku|receipt/i.test(i.name))
      return { title: i.name, topic: 'faturalar', kind: 'document' }
    return {}
  }
  p.organizeAnswer = (g) => {
    if (g.topic === 'düğün') return 'Aile/Düğün (Haziran 2023)'
    if (g.topic === 'python kursu') return 'Kurslar'
    if (g.topic === 'oyun geliştirme') return 'Oyun Geliştirme'
    if (g.topic === 'faturalar') return 'Belgeler/Faturalar'
    return undefined
  }
  return p
}

async function runTopic(
  fx: ScannedFixture,
  provider: FakeProvider,
  signal = new AbortController().signal,
) {
  const files = fx.repos.files.bySession(fx.sessionId)
  const metas = fx.repos.files.metaBySession(fx.sessionId)
  const org = organizeWithRules(files, metas, fx.settings)
  return runTopicAi({ repos: fx.repos, provider, settings: fx.settings }, org, files, metas, signal)
}

describe('topic organisation (revision 1)', () => {
  it('builds topic folders with mixed types and moves coherent folders whole', async () => {
    const fx = await scanFixture()
    const provider = weddingAwareProvider()
    const res = await runTopic(fx, provider)
    const plan = planFromSession(
      fx.repos,
      fx.sessionId,
      fx.settings,
      undefined,
      res.summary,
      res.organization,
    )
    const target = (r: string) => {
      const it = plan.items.find((i) => rel(i.sourcePath, fx.info.dir) === r.normalize('NFC'))
      return it ? rel(it.targetPath, fx.info.dir) : undefined
    }
    // Photos and the video of the wedding end up together, in a topic folder.
    for (const w of fx.info.topics.wedding)
      expect(target(w)).toBe(`Aile/Düğün (Haziran 2023)/${path.basename(w)}`)
    // Course (videos + PDFs) and asset pack move as whole folders, never split.
    expect(target('Python Kursu')).toBe('Kurslar/Python Kursu')
    expect(target('kenney_platformer-pack')).toBe('Oyun Geliştirme/kenney_platformer-pack')
    expect(target('retro sfx')).toBe('Oyun Geliştirme/retro sfx')
    expect(plan.items.some((i) => rel(i.sourcePath, fx.info.dir).startsWith('Python Kursu/'))).toBe(
      false,
    )
    // Invoices from different places land in one subject folder.
    expect(target('lasku_2023_05.pdf')).toBe('Belgeler/Faturalar/lasku_2023_05.pdf')
    // A folder the AI calls a random dump is dissolved and its files placed one by one.
    expect(plan.items.some((i) => rel(i.sourcePath, fx.info.dir) === 'Masaüstü Eski')).toBe(false)
    expect(
      plan.items.some((i) => rel(i.sourcePath, fx.info.dir) === 'Masaüstü Eski/kitap.epub'),
    ).toBe(true)
    // Items carry topic + title for the report.
    const w = plan.items.find((i) => rel(i.sourcePath, fx.info.dir) === fx.info.topics.wedding[0])!
    expect(w.topic).toBe('düğün')
    expect(w.unitTitle).toBe('Düğün — Haziran 2023')
    expect(w.source).toBe('ai')
    // Event photos are represented by a few samples, not all of them.
    const und = provider.jsonCalls.filter((c) => c.pass === 'understand')
    expect(und.reduce((a, c) => a + c.images, 0)).toBeLessThan(40)
    expect(provider.jsonCalls.some((c) => c.pass === 'organize')).toBe(true)
  })

  it('never sends sensitive files (not even their names) to a cloud model', async () => {
    const fx = await scanFixture()
    const provider = weddingAwareProvider()
    await runTopic(fx, provider)
    const all = provider.jsonCalls.map((c) => c.text).join('\n')
    for (const s of fx.info.sensitive) expect(all).not.toContain(path.basename(s))
  })

  it('caches both passes: a second run is free', async () => {
    const fx = await scanFixture()
    const provider = weddingAwareProvider()
    await runTopic(fx, provider)
    const calls = provider.jsonCalls.length
    const files = fx.repos.files.bySession(fx.sessionId)
    const metas = fx.repos.files.metaBySession(fx.sessionId)
    const est = await estimateTopicAi(
      { repos: fx.repos, provider, settings: fx.settings },
      organizeWithRules(files, metas, fx.settings),
      files,
      metas,
    )
    expect(est.files).toBe(0)
    expect(est.cachedFiles).toBeGreaterThan(20)
    const again = await runTopic(fx, provider)
    if (provider.jsonCalls.length !== calls && process.env['DBG_OUT'])
      fs.writeFileSync(
        process.env['DBG_OUT'],
        [
          ...provider.jsonCalls.slice(calls).map((c) => `${c.pass}\n${c.text}`),
          '#####FIRST',
          ...provider.jsonCalls
            .slice(0, calls)
            .filter((c) => c.pass === 'organize')
            .map((c) => c.text),
        ].join('\n=====\n'),
      )
    expect(provider.jsonCalls.length).toBe(calls)
    expect(again.summary.tokensIn).toBe(0)
  })

  it('stopping keeps rule placements for whatever was not understood', async () => {
    const fx = await scanFixture()
    fx.settings.ai.cacheEnabled = false
    const provider = weddingAwareProvider()
    provider.delayMs = 400
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 150)
    const t0 = Date.now()
    const res = await runTopic(fx, provider, ac.signal)
    expect(Date.now() - t0).toBeLessThan(2000)
    const plan = planFromSession(
      fx.repos,
      fx.sessionId,
      fx.settings,
      undefined,
      res.summary,
      res.organization,
    )
    const shot = plan.items.find((i) => i.sourcePath.endsWith('IMG_5001.PNG'))!
    expect(rel(shot.targetPath, fx.info.dir)).toMatch(/^Ekran Görüntüleri\/Telefon\//)
  })

  it('cleans folder paths from the architect', () => {
    const s = defaultSettings()
    const root = path.resolve('/kok/İndirilenler')
    expect(cleanFolder('../../etc/x', root, s)).toBe('etc/x')
    expect(cleanFolder('İndirilenler/Aile/Düğün', root, s)).toBe('Aile/Düğün')
    expect(cleanFolder('a/b/c/d/e', root, s)).toBe('a/b/c')
    expect(cleanFolder('Döndü Karantina/x', root, s)).toBeNull()
    expect(cleanFolder('.', root, s)).toBe('.')
    expect(cleanFolder('Kurs: Python?', root, s)).toBe('Kurs- Python-')
  })

  it('Anthropic: the architect pass uses the organizer model with medium effort', () => {
    const p = new AnthropicProvider({
      apiKey: 'sk-test',
      model: 'claude-haiku-5-5',
      organizerModel: 'claude-sonnet-5-5',
      effort: 'low',
      useBatchApi: false,
      categories: DEFAULT_CATEGORIES,
      corrections: [],
      imageEdge: 768,
    })
    const org = p.jsonRequestParams({
      pass: 'organize',
      system: 's',
      text: 't',
      schema: {},
      maxTokens: 100,
    })
    expect(org.model).toBe('claude-sonnet-5-5')
    expect(org.output_config?.effort).toBe('medium')
    const und = p.jsonRequestParams({
      pass: 'understand',
      system: 's',
      text: 't',
      images: [{ label: 'Thumbnail u_0001 (1/1):', base64: 'AAAA' }],
      schema: {},
      maxTokens: 100,
    })
    expect(und.model).toBe('claude-haiku-5-5')
    expect(und.output_config?.effort).toBe('low')
    expect(JSON.stringify(und.messages)).toContain('"type":"image"')
  })
})
