import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../src/shared/settings'
import { inlineRunner } from '../../src/main/core/pool'
import { runScan } from '../../src/main/core/scanner/session'
import { makeFixtures } from '../../scripts/fixtures/make'
import { memoryRepos } from '../helpers/db'
import { listTree, scanFixture, stubThumbnailer, tempDir } from '../helpers/scan'

describe('scan (fixtures)', () => {
  it('builds a correct inventory', async () => {
    const { info, repos, sessionId } = await scanFixture()
    const files = repos.files.bySession(sessionId)
    const byRel = new Map(files.map((f) => [f.relPath, f]))

    // ~80 entries were created; hidden/excluded ones are not in the inventory
    expect(info.files.length).toBeGreaterThanOrEqual(75)
    expect(byRel.has('.gizli_not.txt')).toBe(false)
    expect(byRel.has('.DS_Store')).toBe(false)
    expect(byRel.has('~$rapor.docx')).toBe(false)

    // bundles are leaves
    for (const b of info.bundles) expect(byRel.get(b)?.kind, b).toBe('bundle')
    expect([...byRel.keys()].some((r) => r.startsWith('Rapor.pages/'))).toBe(false)
    expect([...byRel.keys()].some((r) => r.startsWith('proje/'))).toBe(false)
    expect(byRel.get('proje')?.family).toBe('code')
    expect(repos.files.getMeta(byRel.get('proje')!.id).bundleType).toBe('project')
    expect(byRel.get('Rapor.pages')!.size).toBeGreaterThan(0)

    // kinds, sizes, NFC
    expect(byRel.get('notlar.txt')?.kind).toBe('file')
    expect(byRel.get('Yeni Klasör')?.kind).toBe('dir')
    expect(byRel.has('Çiçek fotoğrafı.jpg'.normalize('NFC'))).toBe(true)
    expect(byRel.get('bos.txt')?.size).toBe(0)

    // families / mime
    expect(byRel.get('IMG_1234.JPG')?.family).toBe('image')
    expect(byRel.get('IMG_1234.JPG')?.mime).toBe('image/jpeg')
    expect(byRel.get('lasku_2023_05.pdf')?.mime).toBe('application/pdf')

    // duplicates share the full hash
    for (const [a, b] of info.duplicates) {
      const fa = byRel.get(a.normalize('NFC'))
      const fb = byRel.get(b.normalize('NFC'))
      expect(fa?.hashFull, a).toBeTruthy()
      expect(fa?.hashFull).toBe(fb?.hashFull)
    }

    // metadata + excerpts + thumbs
    const exif = repos.files.getMeta(byRel.get('IMG_1235.JPG')!.id)
    expect(exif.camera).toContain('iPhone 13')
    expect(exif.hasGps).toBe(true)
    expect(exif.exifDate?.slice(0, 7)).toBe('2023-07')
    expect(exif.thumbPath).toBeTruthy()
    expect(byRel.get('IMG_1235.JPG')?.phash).toMatch(/^[0-9a-f]{16}$/)
    const pdfMeta = repos.files.getMeta(byRel.get('Fatura - Elektrik Mart 2024.pdf')!.id)
    expect(pdfMeta.textExcerpt).toContain('FATURASI')
    expect(pdfMeta.pages).toBe(1)
    expect(repos.files.getMeta(byRel.get('scan0001.pdf')!.id).scanned).toBe(true)
    expect(repos.files.getMeta(byRel.get('CV_2024.docx')!.id).textExcerpt).toContain('Özgeçmiş')
    expect(repos.files.getMeta(byRel.get('bütçe 2024.xlsx')!.id).textExcerpt).toContain('Gelir')
    expect(repos.files.getMeta(byRel.get('sunum.pptx')!.id).textExcerpt).toContain('Çeyrek')
    expect(repos.files.getMeta(byRel.get('yedek.zip')!.id).archiveEntries).toContain(
      'belgeler/not.txt',
    )
    expect(repos.files.getMeta(byRel.get('sesli not 12.wav')!.id).durationSec).toBe(2)
    expect(repos.files.getMeta(byRel.get('Rapor.pages')!.id).thumbPath).toBeTruthy()

    // sensitive: flagged, and no excerpt / thumb persisted
    for (const s of info.sensitive) {
      const f = byRel.get(s)
      expect(f?.sensitive, s).toBe(true)
      const m = repos.files.getMeta(f!.id)
      expect(m.textExcerpt).toBeUndefined()
      expect(m.thumbPath).toBeUndefined()
    }
    expect(byRel.get('notlar.txt')?.sensitive).toBe(false)
  })

  it('supports cancellation', async () => {
    const root = await tempDir()
    const info = await makeFixtures(path.join(root, 'x'))
    const ac = new AbortController()
    ac.abort()
    const summary = await runScan(
      {
        repos: memoryRepos(),
        runner: inlineRunner(2),
        thumbnailer: stubThumbnailer,
        thumbsDir: path.join(root, 't'),
      },
      { roots: [info.dir], settings: defaultSettings(), signal: ac.signal },
    )
    expect(summary.status).toBe('cancelled')
  })

  it('never writes inside the scanned root', async () => {
    const root = await tempDir()
    const info = await makeFixtures(path.join(root, 'x'))
    const before = await listTree(info.dir)
    await runScan(
      {
        repos: memoryRepos(),
        runner: inlineRunner(2),
        thumbnailer: stubThumbnailer,
        thumbsDir: path.join(root, 't'),
      },
      { roots: [info.dir], settings: defaultSettings() },
    )
    expect(await listTree(info.dir)).toEqual(before)
  })
})
