import fs from 'node:fs/promises'
import path from 'node:path'
import { isInside, longPath } from '../platform/paths'

export const lp = longPath

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(lp(p))
    return true
  } catch {
    return false
  }
}

/** Nearest existing ancestor of `p` (p itself if it exists). */
export async function existingAncestor(p: string): Promise<string> {
  let cur = path.resolve(p)
  for (;;) {
    if (await exists(cur)) return cur
    const up = path.dirname(cur)
    if (up === cur) return cur
    cur = up
  }
}

/**
 * Golden rule 4: the path (or, if it does not exist yet, its nearest existing ancestor after
 * realpath) must be inside one of the roots. Symlinks/junctions cannot escape.
 */
export async function assertInsideRoots(p: string, roots: string[]): Promise<void> {
  const abs = path.resolve(p)
  if (!roots.some((r) => isInside(abs, r))) throw codeError('OUTSIDE_ROOT', `outside roots: ${p}`)
  const anc = await existingAncestor(abs)
  const real = await fs.realpath(lp(anc))
  const realRoots = await Promise.all(roots.map((r) => fs.realpath(lp(r)).catch(() => r)))
  const clean = (s: string): string => s.replace(/^\\\\\?\\/, '')
  if (!realRoots.some((r) => isInside(clean(real), clean(r))))
    throw codeError('OUTSIDE_ROOT', `resolves outside roots: ${p}`)
}

export async function sameVolume(a: string, b: string): Promise<boolean> {
  const [sa, sb] = await Promise.all([fs.stat(lp(a)), fs.stat(lp(await existingAncestor(b)))])
  return sa.dev === sb.dev
}

export function codeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

/** Size+mtime fingerprint used by pre-flight and undo. Bundles: mtime of the directory only. */
export async function fingerprint(
  p: string,
): Promise<{ size: number; mtime: number; dir: boolean }> {
  const st = await fs.stat(lp(p))
  return {
    size: st.isDirectory() ? 0 : st.size,
    mtime: Math.round(st.mtimeMs),
    dir: st.isDirectory(),
  }
}

/** Is the directory empty? */
export async function isEmptyDir(p: string): Promise<boolean> {
  try {
    return (await fs.readdir(lp(p))).length === 0
  } catch {
    return false
  }
}
