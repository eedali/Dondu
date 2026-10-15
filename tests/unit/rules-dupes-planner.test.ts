import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../../src/shared/categories'
import { defaultSettings } from '../../src/shared/settings'
import type { FileMeta, FileRecord } from '../../src/shared/types'
import { findDuplicates } from '../../src/main/core/dupes'
import { buildPlan } from '../../src/main/core/planner'
import { classifyFile, dateFromName, keywordCategory } from '../../src/main/core/rules'

const ROOT = path.resolve('/kok/Masaüstü')
let n = 0
function file(rel: string, p: Partial<FileRecord> = {}): FileRecord {
  const name = rel.split('/').pop()!
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  return {
    id: `f${++n}`,
    sessionId: 's',
    root: ROOT,
    relPath: rel,
    name,
    ext,
    kind: 'file',
    family: 'document',
    size: 5000,
    mtime: Date.UTC(2023, 4, 10),
    ctime: 0,
    isHidden: false,
    isCloudPlaceholder: false,
    isLocked: false,
    sensitive: false,
    ...p,
  }
}

describe('rules', () => {
  const s = defaultSettings()
  it('detects screenshots in several languages', () => {
    for (const name of [
      'Ekran Resmi 2024-03-12 14.22.31.png',
      'Screenshot 2023-11-02 at 09.15.44.png',
      'Näyttökuva 2025-01-08.png',
      'Bildschirmfoto 2022-06-01 um 12.00.00.png',
    ])
      expect(classifyFile(file(name, { family: 'image' }), {}, s).category, name).toBe(
        'screenshots',
      )
  })
  it('EXIF photo → photos with the EXIF date', () => {
    const r = classifyFile(
      file('IMG_1.JPG', { family: 'image' }),
      { exifDate: '2021-12-24T19:00:00Z', camera: 'iPhone 13' },
      s,
    )
    expect(r.category).toBe('photos')
    expect(r.confidence).toBeGreaterThanOrEqual(0.9)
    expect(r.date).toEqual({ year: 2021, month: 12 })
  })
  it('invoices by name (TR/FI/EN) and by content with lower confidence', () => {
    expect(classifyFile(file('Fatura Mart.pdf'), {}, s).category).toBe('docs_invoice')
    expect(classifyFile(file('lasku_2023.pdf'), {}, s).category).toBe('docs_invoice')
    const byText = classifyFile(file('belge.pdf'), { textExcerpt: 'ELEKTRİK FATURASI toplam' }, s)
    expect(byText.category).toBe('docs_invoice')
    expect(byText.confidence).toBeCloseTo(0.7)
  })
  it('installers, junk, archives, projects', () => {
    expect(classifyFile(file('setup.exe', { family: 'installer' }), {}, s).category).toBe(
      'installers',
    )
    expect(classifyFile(file('x.crdownload', { family: 'other' }), {}, s).category).toBe('junk')
    expect(classifyFile(file('bos.txt', { size: 0, family: 'text' }), {}, s).category).toBe('junk')
    expect(classifyFile(file('a.zip', { family: 'archive' }), {}, s).category).toBe('archives')
    expect(
      classifyFile(file('proje', { kind: 'bundle', family: 'code' }), { bundleType: 'project' }, s)
        .category,
    ).toBe('code')
  })
  it('keyword matching respects word boundaries for short words', () => {
    expect(keywordCategory('cvs-export.txt', undefined)).toBeNull()
    expect(keywordCategory('CV 2024.pdf', undefined)?.cat).toBe('docs_work')
  })
  it('dates from names', () => {
    expect(dateFromName('lasku_2023_05.pdf')).toEqual({ year: 2023, month: 5 })
    expect(dateFromName('Fatura Mart 2024.pdf')).toEqual({ year: 2024, month: 3 })
    expect(dateFromName('rapor-2019.docx')).toEqual({ year: 2019 })
    expect(dateFromName('IMG_1234.jpg')).toBeUndefined()
  })
})

describe('dupes', () => {
  it('groups exact duplicates and keeps the non-copy in the preferred folder', () => {
    const s = defaultSettings()
    const a = file('Fatura.pdf', { hashFull: 'h1', mtime: 2 })
    const b = file('İndirilenler/Fatura (1).pdf', { hashFull: 'h1', mtime: 1 })
    const c = file('Belgeler/eski.pdf', { hashFull: 'h2' })
    const r = findDuplicates([a, b, c], s)
    expect(r.exact).toHaveLength(1)
    expect(r.exact[0]!.keep.id).toBe(a.id)
    expect(r.exact[0]!.others.map((o) => o.id)).toEqual([b.id])
  })
  it('near duplicates by dHash distance, HEIC/JPG siblings', () => {
    const s = defaultSettings()
    const x = file('a.png', { family: 'image', phash: 'ffff0000ffff0000' })
    const y = file('b.png', { family: 'image', phash: 'ffff0000ffff0003' })
    const z = file('c.png', { family: 'image', phash: '0000ffff0000ffff' })
    const heic = file('IMG_9.HEIC', { family: 'image' })
    const jpg = file('IMG_9.JPG', { family: 'image' })
    const r = findDuplicates([x, y, z, heic, jpg], s)
    expect(r.near).toHaveLength(1)
    expect(r.near[0]!.others).toHaveLength(1)
    expect(r.siblings.get(jpg.id)).toBe(heic.id)
  })
})

describe('planner', () => {
  const s = defaultSettings()
  const metas = new Map<string, FileMeta>()
  const fixedNow = Date.UTC(2026, 9, 15, 12, 0)

  it('is deterministic and maps categories to template folders', () => {
    const files = [
      file('Fatura Mart 2024.pdf'),
      file('IMG_1.JPG', { family: 'image' }),
      file('notlar.txt', { family: 'text' }),
      file('cloud.pdf', { isCloudPlaceholder: true }),
    ]
    metas.set(files[1]!.id, { exifDate: '2023-07-14T11:03:00Z' })
    const input = {
      planId: 'p1',
      sessionId: 's',
      roots: [ROOT],
      files,
      metas,
      settings: s,
      categories: DEFAULT_CATEGORIES,
      now: fixedNow,
    }
    const p1 = buildPlan(input)
    const p2 = buildPlan(input)
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2))
    const byName = new Map(p1.items.map((i) => [path.basename(i.sourcePath), i]))
    expect(byName.get('Fatura Mart 2024.pdf')!.targetPath).toBe(
      path.join(ROOT, 'Belgeler', 'Fatura ve Makbuz', '2024', 'Fatura Mart 2024.pdf'),
    )
    expect(byName.get('IMG_1.JPG')!.targetPath).toBe(
      path.join(ROOT, 'Fotoğraflar', '2023', '07', 'IMG_1.JPG'),
    )
    // low confidence → review, disabled by default
    expect(byName.get('notlar.txt')!.enabled).toBe(false)
    expect(byName.get('notlar.txt')!.flags).toContain('low_confidence')
    // cloud placeholders are skipped
    expect(byName.get('cloud.pdf')!.action).toBe('skip')
  })

  it('resolves plan-internal collisions and keeps files already in place', () => {
    const files = [
      file('a/Fatura 2024.pdf'),
      file('b/Fatura 2024.pdf'),
      file('Belgeler/Fatura ve Makbuz/2024/eski fatura 2024.pdf'),
    ]
    const p = buildPlan({
      planId: 'p2',
      sessionId: 's',
      roots: [ROOT],
      files,
      metas: new Map(),
      settings: s,
      categories: DEFAULT_CATEGORIES,
      now: fixedNow,
    })
    const targets = p.items
      .filter((i) => i.action !== 'skip')
      .map((i) => path.basename(i.targetPath))
      .sort()
    expect(targets).toEqual(['Fatura 2024 (2).pdf', 'Fatura 2024.pdf'])
    expect(p.items.find((i) => i.sourcePath.includes('eski fatura'))!.action).toBe('skip')
  })

  it('quarantines exact duplicates into the quarantine folder of their root', () => {
    const files = [file('x.pdf', { hashFull: 'h' }), file('y (1).pdf', { hashFull: 'h' })]
    const p = buildPlan({
      planId: 'p3',
      sessionId: 's',
      roots: [ROOT],
      files,
      metas: new Map(),
      settings: s,
      categories: DEFAULT_CATEGORIES,
      now: fixedNow,
    })
    const q = p.items.find((i) => i.action === 'quarantine')!
    expect(q.sourcePath.endsWith('y (1).pdf')).toBe(true)
    expect(q.targetPath.startsWith(path.join(ROOT, 'Döndü Karantina'))).toBe(true)
    expect(q.enabled).toBe(true)
    expect(p.summary.quarantine).toBe(1)
  })

  it('renames generic names only when enabled and confident', () => {
    const st = defaultSettings()
    st.rename.enabled = true
    const f = file('scan0001.pdf')
    const ai = new Map([
      [
        f.id,
        {
          id: f.id,
          category: 'docs_invoice',
          confidence: 0.95,
          sensitive: false,
          reason: 'Fatura',
          suggestedName: 'Elektrik faturası',
          dateHint: '2024-03',
        },
      ],
    ])
    const p = buildPlan({
      planId: 'p4',
      sessionId: 's',
      roots: [ROOT],
      files: [f],
      metas: new Map(),
      settings: st,
      categories: DEFAULT_CATEGORIES,
      ai,
      now: fixedNow,
    })
    const it = p.items[0]!
    expect(it.action).toBe('move_rename')
    expect(path.basename(it.targetPath)).toMatch(/^2024-03-\d{2}_Elektrik faturası\.pdf$/)
    expect(it.source).toBe('ai')
  })

  it('sends sensitive documents to the personal folder', () => {
    const f = file('kimlik.pdf', { sensitive: true, sensitiveReason: 'ad' })
    const p = buildPlan({
      planId: 'p5',
      sessionId: 's',
      roots: [ROOT],
      files: [f],
      metas: new Map(),
      settings: s,
      categories: DEFAULT_CATEGORIES,
      now: fixedNow,
    })
    expect(p.items[0]!.category).toBe('docs_personal_id')
    expect(p.items[0]!.flags).toContain('sensitive')
  })
})

describe('near duplicates (revision 1)', () => {
  it('travel with their group instead of being left behind', () => {
    const s = defaultSettings()
    const a = file('IMG_1.JPG', { family: 'image', phash: 'ffff0000ffff0000' })
    const b = file('IMG_2.JPG', { family: 'image', phash: 'ffff0000ffff0001' })
    const metas = new Map<string, FileMeta>([
      [a.id, { exifDate: '2023-06-17T15:00:00Z', camera: 'iPhone 14' }],
      [b.id, { exifDate: '2023-06-17T15:00:02Z', camera: 'iPhone 14' }],
    ])
    const p = buildPlan({
      planId: 'pn',
      sessionId: 's',
      roots: [ROOT],
      files: [a, b],
      metas,
      settings: s,
      categories: DEFAULT_CATEGORIES,
      now: Date.UTC(2026, 9, 15),
    })
    const items = p.items.filter((i) => i.action === 'move')
    expect(items).toHaveLength(2)
    expect(new Set(items.map((i) => path.dirname(i.targetPath))).size).toBe(1)
    const near = items.find((i) => i.flags.includes('near_duplicate'))!
    expect(near.enabled).toBe(true)
    expect(near.duplicateOf).toBeDefined()
  })
})
