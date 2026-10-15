import path from 'node:path'

/** NFC + platform-neutral helpers. DB stores rel paths with posix separators, NFC. */

export const nfc = (s: string): string => s.normalize('NFC')

/** True on file systems that are case-insensitive by default (APFS, NTFS). */
export const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32'

export function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

export function relPosix(root: string, abs: string): string {
  return nfc(toPosix(path.relative(root, abs)))
}

export function joinRel(root: string, rel: string): string {
  return path.join(root, ...rel.split('/'))
}

/** Comparison key: NFC, and lower-cased on case-insensitive file systems. */
export function pathKey(p: string, caseInsensitive = CASE_INSENSITIVE): string {
  const n = nfc(path.resolve(p))
  return caseInsensitive ? n.toLowerCase() : n
}

/** Is `child` equal to or inside `parent` (after resolve + NFC + case folding)? */
export function isInside(
  child: string,
  parent: string,
  caseInsensitive = CASE_INSENSITIVE,
): boolean {
  const c = pathKey(child, caseInsensitive)
  const p = pathKey(parent, caseInsensitive)
  if (c === p) return true
  const withSep = p.endsWith(path.sep) ? p : p + path.sep
  return c.startsWith(withSep)
}

export function isInsideAny(child: string, roots: string[]): boolean {
  return roots.some((r) => isInside(child, r))
}

/** Windows long-path prefix when needed (docs/04 §2.2). */
export function longPath(p: string): string {
  if (process.platform !== 'win32') return p
  const abs = path.resolve(p)
  if (abs.length < 240 || abs.startsWith('\\\\?\\')) return abs
  if (abs.startsWith('\\\\')) return '\\\\?\\UNC\\' + abs.slice(2)
  return '\\\\?\\' + abs
}

/** Merges roots: drops duplicates and roots nested inside another selected root. */
export function mergeRoots(roots: string[]): string[] {
  const sorted = [...new Set(roots.map((r) => path.resolve(r)))].sort((a, b) => a.length - b.length)
  const out: string[] = []
  for (const r of sorted) if (!out.some((o) => isInside(r, o))) out.push(r)
  return out
}
