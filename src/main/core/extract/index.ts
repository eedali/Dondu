import fs from 'node:fs/promises'
import path from 'node:path'
import type { FileFamily, FileKind, FileMeta } from '@shared/types'
import { fastHash } from '../hash'
import { longPath } from '../platform/paths'
import { TEXT_EXTS, familyOf } from '../scanner/types'
import { extractPdf } from './pdf'
import { listZip, readZipEntry } from './zip'

export interface ContentTask {
  abs: string
  name: string
  ext: string
  kind: FileKind
  family: FileFamily
  size: number
  maxChars: number
  maxContentBytes: number
}

export interface ContentResult {
  mime?: string
  family: FileFamily
  hashFast?: string
  meta: FileMeta
  /** A file the thumbnailer should use instead of `abs` (e.g. iWork preview.jpg). */
  thumbSource?: string
  /** Bundles: total size of the tree. */
  size?: number
}

const clean = (s: string, max: number): string =>
  s
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)

async function readHead(file: string, bytes: number): Promise<Buffer> {
  const fh = await fs.open(longPath(file), 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await fh.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  const utf8 = buf.toString('utf8')
  // Many Turkish files are Windows-1254; fall back to latin1 when utf8 is clearly broken.
  const bad = (utf8.match(/�/g) ?? []).length
  return bad > 3 ? buf.toString('latin1') : utf8
}

async function sniffMime(file: string): Promise<string | undefined> {
  try {
    const { fileTypeFromFile } = await import('file-type')
    return (await fileTypeFromFile(longPath(file)))?.mime
  } catch {
    return undefined
  }
}

/** PNG width/height straight from the IHDR chunk (exact pixel size → screenshot detection). */
async function pngSize(file: string): Promise<{ width: number; height: number } | undefined> {
  const head = await readHead(file, 24)
  if (
    head.length < 24 ||
    head.readUInt32BE(0) !== 0x89504e47 ||
    head.toString('ascii', 12, 16) !== 'IHDR'
  )
    return undefined
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}

async function extractImage(file: string): Promise<FileMeta> {
  const exifr = (await import('exifr')).default
  const meta: FileMeta = {}
  const png = await pngSize(file).catch(() => undefined)
  if (png) {
    meta.width = png.width
    meta.height = png.height
  }
  try {
    const tags = (await exifr.parse(longPath(file), {
      tiff: true,
      exif: true,
      gps: true,
      ifd1: false,
      xmp: false,
      icc: false,
      iptc: false,
      translateValues: false,
      pick: [
        'DateTimeOriginal',
        'CreateDate',
        'Make',
        'Model',
        'Orientation',
        'GPSLatitude',
        'GPSLongitude',
        'ExifImageWidth',
        'ExifImageHeight',
        'ImageWidth',
        'ImageHeight',
      ],
    })) as Record<string, unknown> | undefined
    if (tags) {
      const d = (tags['DateTimeOriginal'] ?? tags['CreateDate']) as Date | string | undefined
      if (d instanceof Date && !Number.isNaN(d.getTime())) meta.exifDate = d.toISOString()
      else if (typeof d === 'string') meta.exifDate = d
      const make = typeof tags['Make'] === 'string' ? tags['Make'].trim() : ''
      const model = typeof tags['Model'] === 'string' ? tags['Model'].trim() : ''
      if (make || model) meta.camera = model.startsWith(make) ? model : `${make} ${model}`.trim()
      meta.hasGps = tags['GPSLatitude'] !== undefined && tags['GPSLongitude'] !== undefined
      if (typeof tags['Orientation'] === 'number') meta.orientation = tags['Orientation']
      const w = tags['ExifImageWidth'] ?? tags['ImageWidth']
      const h = tags['ExifImageHeight'] ?? tags['ImageHeight']
      if (typeof w === 'number' && typeof h === 'number') {
        meta.width = w
        meta.height = h
      }
    }
  } catch {
    /* no EXIF */
  }
  return meta
}

async function extractDocx(file: string, max: number): Promise<FileMeta> {
  const mammoth = await import('mammoth')
  const res = await mammoth.extractRawText({ path: longPath(file) })
  const meta: FileMeta = {}
  const text = clean(res.value, max)
  if (text) meta.textExcerpt = text
  const core = await readZipEntry(file, (n) => n === 'docProps/core.xml', 256 * 1024).catch(
    () => null,
  )
  if (core) {
    const xml = core.toString('utf8')
    const title = /<dc:title>([^<]*)<\/dc:title>/.exec(xml)?.[1]?.trim()
    const author = /<dc:creator>([^<]*)<\/dc:creator>/.exec(xml)?.[1]?.trim()
    if (title) meta.title = title
    if (author) meta.author = author
  }
  return meta
}

async function extractSheet(file: string, max: number): Promise<FileMeta> {
  const XLSX = await import('xlsx')
  const buf = await fs.readFile(longPath(file))
  const wb = XLSX.read(buf, { type: 'buffer', sheetRows: 30, cellFormula: false, cellHTML: false })
  const first = wb.SheetNames[0]
  const meta: FileMeta = {}
  if (first) {
    const sheet = wb.Sheets[first]
    if (sheet) {
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
      const text = clean(`${first}\n${csv}`, max)
      if (text) meta.textExcerpt = text
    }
  }
  const props = wb.Props
  if (props?.Title) meta.title = props.Title
  if (props?.Author) meta.author = props.Author
  return meta
}

async function extractPptx(file: string, max: number): Promise<FileMeta> {
  const slide = await readZipEntry(file, (n) => n === 'ppt/slides/slide1.xml', 2 * 1024 * 1024)
  const meta: FileMeta = {}
  if (slide) {
    const text = [...slide.toString('utf8').matchAll(/<a:t>([^<]*)<\/a:t>/g)]
      .map((m) => m[1])
      .join(' ')
    if (text.trim()) meta.textExcerpt = clean(text, max)
  }
  const { count } = await listZip(file, 0).catch(() => ({ count: 0 }))
  if (count) meta.archiveEntryCount = count
  return meta
}

async function extractAudioVideo(file: string): Promise<FileMeta> {
  const mm = await import('music-metadata')
  const res = await mm.parseFile(longPath(file), { duration: true, skipCovers: true })
  const meta: FileMeta = {}
  if (res.format.duration) meta.durationSec = Math.round(res.format.duration)
  if (res.common.title) meta.title = res.common.title
  if (res.common.artist) meta.artist = res.common.artist
  if (res.common.album) meta.album = res.common.album
  return meta
}

async function bundleSize(dir: string, limit = 20000): Promise<number> {
  let total = 0
  let n = 0
  const walk = async (d: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(longPath(d), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (++n > limit) return
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) total += (await fs.lstat(longPath(p)).catch(() => ({ size: 0 }))).size
    }
  }
  await walk(dir)
  return total
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const p of paths) {
    try {
      await fs.access(longPath(p))
      return p
    } catch {
      /* next */
    }
  }
  return undefined
}

/**
 * Content analysis that does not need Electron (runs in a worker thread): mime sniff, fast hash,
 * metadata and a short text excerpt. Thumbnails are produced later on the main thread.
 */
export async function analyzeContent(t: ContentTask): Promise<ContentResult> {
  const res: ContentResult = { family: t.family, meta: {} }

  if (t.kind === 'bundle') {
    res.size = await bundleSize(t.abs)
    if (['pages', 'numbers', 'key'].includes(t.ext)) {
      res.thumbSource = await firstExisting([
        path.join(t.abs, 'preview.jpg'),
        path.join(t.abs, 'QuickLook', 'Thumbnail.jpg'),
        path.join(t.abs, 'preview-web.jpg'),
      ])
    }
    return res
  }
  if (t.kind !== 'file' || t.size === 0) return res

  res.hashFast = await fastHash(t.abs, t.size)
  res.mime = await sniffMime(t.abs)
  if (res.family === 'other' && res.mime) res.family = familyOf(t.ext, res.mime)
  if (t.size > t.maxContentBytes) return res

  const max = t.maxChars
  try {
    const mime = res.mime ?? ''
    if (res.family === 'image' || mime.startsWith('image/')) {
      res.meta = await extractImage(t.abs)
    } else if (t.ext === 'pdf' || mime === 'application/pdf') {
      res.meta = await extractPdf(t.abs, max)
    } else if (t.ext === 'docx') {
      res.meta = await extractDocx(t.abs, max)
    } else if (['xlsx', 'xlsm', 'xls', 'ods'].includes(t.ext)) {
      res.meta = await extractSheet(t.abs, max)
    } else if (t.ext === 'pptx') {
      res.meta = await extractPptx(t.abs, max)
    } else if (TEXT_EXTS.has(t.ext) || (mime.startsWith('text/') && t.size < 5 * 1024 * 1024)) {
      const text = clean(decodeText(await readHead(t.abs, Math.max(max * 4, 8192))), max)
      if (text) res.meta.textExcerpt = text
    } else if (res.family === 'audio' || res.family === 'video') {
      res.meta = await extractAudioVideo(t.abs)
    } else if (t.ext === 'zip' || mime === 'application/zip') {
      const { entries, count } = await listZip(t.abs, 50)
      res.meta = { archiveEntries: entries, archiveEntryCount: count }
    } else if (['pages', 'numbers', 'key'].includes(t.ext)) {
      // Single-file iWork documents are zips with an embedded preview.
      const { entries, count } = await listZip(t.abs, 50).catch(() => ({ entries: [], count: 0 }))
      res.meta = { archiveEntryCount: count }
      if (entries.length === 0) res.meta.error = 'unreadable'
    }
  } catch (e) {
    res.meta.error = (e as Error).message.slice(0, 200)
  }
  return res
}
