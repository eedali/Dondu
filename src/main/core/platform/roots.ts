import fs from 'node:fs/promises'
import path from 'node:path'
import type { FolderPickResult } from '@shared/ipc'
import type { PlatformAdapter } from '.'
import { isInside, mergeRoots } from './paths'

/** Validates user-picked roots: no system/app folders, must exist, nested roots merged. */
export async function validateRoots(
  paths: string[],
  existing: string[],
  adapter: PlatformAdapter,
  appDirs: string[],
): Promise<FolderPickResult> {
  const res: FolderPickResult = { accepted: [], rejected: [] }
  for (const raw of paths) {
    const p = path.resolve(raw)
    if (adapter.isSystemFolder(p)) {
      res.rejected.push({ path: p, reason: 'system' })
      continue
    }
    if (appDirs.some((d) => isInside(p, d) || isInside(d, p))) {
      res.rejected.push({ path: p, reason: 'app' })
      continue
    }
    try {
      const st = await fs.stat(p)
      if (!st.isDirectory()) {
        res.rejected.push({ path: p, reason: 'not_dir' })
        continue
      }
    } catch {
      res.rejected.push({ path: p, reason: 'missing' })
      continue
    }
    if (existing.some((e) => isInside(p, e))) {
      res.rejected.push({ path: p, reason: 'nested' })
      continue
    }
    res.accepted.push(p)
  }
  res.accepted = mergeRoots([...existing, ...res.accepted]).filter(
    (r) => !existing.some((e) => path.resolve(e) === r),
  )
  return res
}
