import fs from 'node:fs/promises'
import type { FileMeta } from '@shared/types'
import { longPath } from '../platform/paths'

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjsPromise: Promise<PdfJs> | null = null
const loadPdfJs = (): Promise<PdfJs> => (pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs'))

/** First 3 pages of text (≤ maxChars), page count, title/author; `scanned` when no text. */
export async function extractPdf(file: string, maxChars: number): Promise<FileMeta> {
  const pdfjs = await loadPdfJs()
  const data = new Uint8Array(await fs.readFile(longPath(file)))
  const task = pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  })
  const doc = await task.promise
  try {
    const meta: FileMeta = { pages: doc.numPages }
    try {
      const info = (await doc.getMetadata()).info as Record<string, unknown> | undefined
      if (typeof info?.['Title'] === 'string' && info['Title'].trim())
        meta.title = info['Title'].trim()
      if (typeof info?.['Author'] === 'string' && info['Author'].trim())
        meta.author = info['Author'].trim()
    } catch {
      /* metadata optional */
    }
    let text = ''
    for (let p = 1; p <= Math.min(3, doc.numPages) && text.length < maxChars; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      text += content.items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n'
      page.cleanup()
    }
    text = text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (text) meta.textExcerpt = text.slice(0, maxChars)
    else meta.scanned = true
    return meta
  } finally {
    await task.destroy()
  }
}
