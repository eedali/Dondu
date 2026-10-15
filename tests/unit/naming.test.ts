import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  expandFolder,
  expandName,
  isGenericName,
  sanitizeFileName,
  sanitizeSegment,
  uniquePath,
  withSuffix,
} from '../../src/main/core/naming'

describe('sanitize', () => {
  it('removes characters forbidden on Windows or macOS', () => {
    expect(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j.pdf')).toBe('a-b-c-d-e-f-g-h-i-j.pdf')
  })
  it('handles reserved device names even with an extension', () => {
    expect(sanitizeFileName('CON.txt')).toBe('_CON.txt')
    expect(sanitizeFileName('lpt1')).toBe('_lpt1')
    expect(sanitizeFileName('console.txt')).toBe('console.txt')
  })
  it('drops trailing dots/spaces, leading dots, empty names', () => {
    expect(sanitizeSegment('rapor. . ')).toBe('rapor')
    expect(sanitizeSegment('...gizli')).toBe('gizli')
    expect(sanitizeSegment('   ')).toBe('adsiz')
  })
  it('normalises to NFC and caps at 200 chars keeping the extension', () => {
    const nfd = 'Çiçek'.normalize('NFD') + '.jpg'
    expect(sanitizeFileName(nfd)).toBe('Çiçek.jpg'.normalize('NFC'))
    const long = 'a'.repeat(300) + '.tar.gz'
    const out = sanitizeFileName(long)
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out.endsWith('.tar.gz')).toBe(true)
  })
})

describe('templates', () => {
  it('expands folder templates and drops empty segments', () => {
    expect(expandFolder('Fotoğraflar/{Yıl}/{Ay}', { year: 2024, month: 7 })).toBe(
      'Fotoğraflar/2024/07',
    )
    expect(expandFolder('Belgeler/{Kategori}/{Yıl}', { category: 'Fatura', year: undefined })).toBe(
      'Belgeler/Fatura',
    )
    expect(expandFolder('../../{Kök}/x', { rootName: 'Masaüstü' })).toBe('Masaüstü/x')
  })
  it('expands rename templates with the original extension', () => {
    expect(
      expandName('{date}_{title}', { date: '2024-03-01', title: 'Elektrik faturası' }, 'pdf'),
    ).toBe('2024-03-01_Elektrik faturası.pdf')
    expect(expandName('{date}_{title}', { date: '2024-03-01' }, 'pdf')).toBe('2024-03-01.pdf')
  })
  it('recognises generic names', () => {
    for (const n of [
      'IMG_1234.JPG',
      'Belge (3).pdf',
      'Untitled.docx',
      'scan0001.pdf',
      '20240101.jpg',
      'Ekran Resmi 2024-03-12 14.22.31.png',
    ])
      expect(isGenericName(n), n).toBe(true)
    for (const n of ['Kira Sözleşmesi.pdf', 'tatil-plaj.jpg'])
      expect(isGenericName(n), n).toBe(false)
  })
})

describe('collisions', () => {
  it('suffixes " (2)", " (3)" and never returns an existing path', () => {
    expect(withSuffix('a.pdf', 2)).toBe('a (2).pdf')
    expect(withSuffix('a.tar.gz', 3)).toBe('a (3).tar.gz')
    expect(withSuffix('a.pdf', 1, 'geri alındı')).toBe('a (geri alındı).pdf')
    const dir = path.resolve('/x')
    const existing = new Set([path.join(dir, 'a.pdf'), path.join(dir, 'a (2).pdf')])
    expect(uniquePath(path.join(dir, 'a.pdf'), new Set(), (p) => existing.has(p))).toBe(
      path.join(dir, 'a (3).pdf'),
    )
    expect(uniquePath(path.join(dir, 'b.pdf'), new Set(), (p) => existing.has(p))).toBe(
      path.join(dir, 'b.pdf'),
    )
  })
})
