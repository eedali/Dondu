import fs from 'node:fs'
import path from 'node:path'
import { pathKey } from '../platform/paths'
import { splitExt } from '../scanner/types'

/**
 * File name rules that are safe on both macOS and Windows (docs/04 §3): forbidden characters,
 * reserved device names, trailing dots/spaces, NFC, 200 char cap, extension preserved.
 */

// eslint-disable-next-line no-control-regex -- control characters are forbidden in names
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f\u007f]/g
const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i
export const MAX_NAME = 200
export const FALLBACK_NAME = 'adsiz'

export function sanitizeSegment(raw: string, maxLen = MAX_NAME): string {
  let s = raw.normalize('NFC').replace(FORBIDDEN, '-')
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/[. ]+$/g, '') // Windows drops trailing dots/spaces
  s = s.replace(/^\.+/, '') // no accidental hidden files
  if (!s) s = FALLBACK_NAME
  const base = s.split('.')[0] ?? s
  if (RESERVED.test(base)) s = `_${s}`
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/[. ]+$/g, '')
  return s || FALLBACK_NAME
}

/** Sanitizes a whole file name, keeping (and lower-casing nothing of) the extension. */
export function sanitizeFileName(name: string): string {
  const { stem, ext } = splitExt(name.normalize('NFC'))
  const origExt = ext ? name.normalize('NFC').slice(-ext.length) : ''
  const safeExt = origExt.replace(FORBIDDEN, '').slice(0, 20)
  const maxStem = MAX_NAME - (safeExt ? safeExt.length + 1 : 0)
  const safeStem = sanitizeSegment(stem, maxStem)
  return safeExt ? `${safeStem}.${safeExt}` : safeStem
}

/** Sanitizes each segment of a relative folder path ("Belgeler/Fatura ve Makbuz/2024"). */
export function sanitizeRelDir(rel: string): string {
  return rel
    .split(/[\\/]+/)
    .filter((s) => s && s !== '.' && s !== '..')
    .map((s) => sanitizeSegment(s))
    .join('/')
}

// ---------------------------------------------------------------- templates

export interface TemplateVars {
  year?: number
  month?: number
  category?: string
  rootName?: string
  date?: string
  title?: string
  orig?: string
  event?: string
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/**
 * Expands {Yıl} {Ay} {Kategori} {Kök} {date} {title} {orig} {Etkinlik}. Unknown/missing values
 * collapse (a folder segment that ends up empty is dropped).
 */
export function expandTemplate(tpl: string, v: TemplateVars): string {
  const map: Record<string, string | undefined> = {
    yıl: v.year ? String(v.year) : undefined,
    yil: v.year ? String(v.year) : undefined,
    year: v.year ? String(v.year) : undefined,
    ay: v.month ? pad2(v.month) : undefined,
    month: v.month ? pad2(v.month) : undefined,
    kategori: v.category,
    category: v.category,
    kök: v.rootName,
    kok: v.rootName,
    root: v.rootName,
    date: v.date,
    tarih: v.date,
    title: v.title,
    başlık: v.title,
    baslik: v.title,
    orig: v.orig,
    etkinlik: v.event,
    event: v.event,
  }
  return tpl.replace(/\{([^}]+)\}/g, (_, k: string) => map[k.toLocaleLowerCase('tr-TR')] ?? '')
}

/** Folder template → sanitized relative dir (empty segments removed). */
export function expandFolder(tpl: string, v: TemplateVars): string {
  return sanitizeRelDir(expandTemplate(tpl, v))
}

/** Rename template → sanitized file name with the original extension. */
export function expandName(tpl: string, v: TemplateVars, ext: string): string {
  const raw = expandTemplate(tpl, v)
    .replace(/^[_\-\s]+|[_\-\s]+$/g, '')
    .replace(/[_-]{2,}/g, '_')
  const stem = raw || v.orig || FALLBACK_NAME
  return sanitizeFileName(ext ? `${stem}.${ext}` : stem)
}

const GENERIC_RE =
  /^(img|dsc|dscn|dscf|pxl|mvimg|photo|image|scan|scanned|document|belge|dosya|untitled|adsız|adsiz|yeni|new|download|indir|file|ekran resmi|ekran görüntüsü|screenshot|screen shot|näyttökuva|bildschirmfoto|whatsapp image|cv|doc)[\s_\-()0-9.:at]*$/i

/** "IMG_1234", "Belge (3)", "Untitled", "Ekran Resmi 2024-…" … */
export function isGenericName(name: string): boolean {
  const { stem } = splitExt(name)
  const s = stem.normalize('NFC').trim()
  if (/^[\d\s_\-().]+$/.test(s)) return true
  return GENERIC_RE.test(s)
}

// ---------------------------------------------------------------- collisions

/** "a.pdf" → "a (2).pdf", "a (3).pdf" … */
export function withSuffix(name: string, n: number, label?: string): string {
  const { stem, ext } = splitExt(name)
  const origExt = ext ? name.slice(-ext.length) : ''
  const tag = label ? ` (${label}${n > 1 ? ` ${n}` : ''})` : ` (${n})`
  return origExt ? `${stem}${tag}.${origExt}` : `${stem}${tag}`
}

/**
 * Returns a path that does not exist on disk and is not in `taken` (case/NFC-insensitive keys).
 * Never overwrites: suffix " (2)", " (3)" …
 */
export function uniquePath(
  target: string,
  taken: Set<string> = new Set(),
  exists: (p: string) => boolean = fs.existsSync,
  label?: string,
): string {
  const dir = path.dirname(target)
  const name = path.basename(target)
  let n = 1
  let candidate = label ? path.join(dir, withSuffix(name, 1, label)) : target
  while (taken.has(pathKey(candidate)) || exists(candidate)) {
    n++
    candidate = path.join(dir, withSuffix(name, n, label))
  }
  return candidate
}
