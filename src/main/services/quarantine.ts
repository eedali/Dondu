import fs from 'node:fs/promises'
import path from 'node:path'
import type { QuarantineInfo } from '@shared/ipc'
import { context } from '../context'
import { sanitizeSegment } from '../core/naming'
import { platform } from '../core/platform'
import { isInside, longPath } from '../core/platform/paths'
import { log } from './log'

async function dirSize(p: string): Promise<number> {
  let total = 0
  for (const e of await fs.readdir(longPath(p), { withFileTypes: true }).catch(() => [])) {
    const c = path.join(p, e.name)
    if (e.isDirectory()) total += await dirSize(c)
    else total += (await fs.lstat(longPath(c)).catch(() => ({ size: 0 }))).size
  }
  return total
}

export async function listQuarantine(): Promise<QuarantineInfo[]> {
  const ctx = context()
  const s = ctx.settings.get()
  const out: QuarantineInfo[] = []
  for (const root of s.roots) {
    const q = path.join(root, sanitizeSegment(s.quarantineFolderName))
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(longPath(q), { withFileTypes: true })
    } catch {
      continue
    }
    let oldest = Date.now()
    for (const e of entries) {
      const st = await fs.stat(longPath(path.join(q, e.name))).catch(() => null)
      if (st) oldest = Math.min(oldest, st.mtimeMs)
    }
    out.push({
      root,
      path: q,
      runs: entries.filter((e) => e.isDirectory()).length,
      bytes: await dirSize(q),
      oldestDays: Math.floor((Date.now() - oldest) / 86_400_000),
    })
  }
  return out
}

/** "Empty the quarantine" = send it to the OS trash. Never a direct delete. */
export async function trashQuarantine(p: string): Promise<{ ok: boolean; message?: string }> {
  const ctx = context()
  const s = ctx.settings.get()
  const allowed = s.roots.map((r) => path.join(r, sanitizeSegment(s.quarantineFolderName)))
  if (!allowed.some((a) => isInside(p, a))) return { ok: false, message: 'not_quarantine' }
  try {
    await platform().trash(p)
    log.info(`quarantine sent to trash: ${p}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
