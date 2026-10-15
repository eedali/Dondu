import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { FileFamily, FileKind, FileRecord } from '@shared/types'
import type { Settings } from '@shared/settings'
import { platform } from '../platform'
import { longPath, nfc, relPosix, toPosix } from '../platform/paths'
import { Excluder } from './exclude'
import { BUNDLE_EXTS, PROJECT_MARKER_EXTS, PROJECT_MARKERS, familyOf, splitExt } from './types'

export interface WalkOptions {
  sessionId: string
  roots: string[]
  scan: Settings['scan']
  quarantineFolderName: string
  signal?: AbortSignal
  /** Called with each batch (≤ batchSize records). */
  onBatch: (records: FileRecord[]) => void
  onProgress?: (found: number, currentPath: string) => void
  batchSize?: number
}

export interface WalkResult {
  found: number
  bundleTypes: Map<string, 'apple' | 'project'>
  dirContents: Map<string, { contents: Record<string, number>; subfolders: number }>
}

const yieldToLoop = (): Promise<void> => new Promise((r) => setImmediate(r))

async function isAppleBundle(abs: string, ext: string): Promise<boolean> {
  if (BUNDLE_EXTS.has(ext)) return true
  try {
    await fs.access(path.join(abs, 'Contents', 'Info.plist'))
    return true
  } catch {
    return false
  }
}

function isProject(childNames: string[]): boolean {
  return childNames.some(
    (n) => PROJECT_MARKERS.includes(n) || PROJECT_MARKER_EXTS.includes(splitExt(n).ext),
  )
}

/**
 * Walks the roots with opendir + lstat. Never follows symlinks/junctions, never descends into
 * bundles or project folders, honours exclusions, depth and hidden settings. Read-only.
 */
export async function walk(opts: WalkOptions): Promise<WalkResult> {
  const { scan, signal } = opts
  const batchSize = opts.batchSize ?? 500
  const excluder = new Excluder(scan.excludeGlobs)
  const plat = platform()
  const enabledFamilies = scan.fileTypes as Record<FileFamily, boolean>
  let batch: FileRecord[] = []
  let found = 0
  const bundleTypes = new Map<string, 'apple' | 'project'>()
  const dirContents = new Map<string, { contents: Record<string, number>; subfolders: number }>()

  const flush = (): void => {
    if (batch.length) opts.onBatch(batch)
    batch = []
  }

  const push = (rec: FileRecord): void => {
    batch.push(rec)
    found++
    if (batch.length >= batchSize) flush()
  }

  for (const root of opts.roots) {
    const placeholders = await plat.cloudPlaceholders(root)
    const quarantineRel = nfc(opts.quarantineFolderName).toLowerCase()

    const visit = async (dirAbs: string, depth: number): Promise<void> => {
      if (signal?.aborted) return
      let names: string[]
      try {
        const dir = await fs.opendir(longPath(dirAbs))
        names = []
        for await (const d of dir) names.push(d.name)
      } catch {
        return // unreadable directory: skip silently (reported by access check)
      }
      const relDir = relPosix(root, dirAbs)
      const rawRelDir = toPosix(path.relative(root, dirAbs))
      const hist: Record<string, number> = {}
      let subfolders = 0

      for (const rawName of names) {
        if (signal?.aborted) return
        const abs = path.join(dirAbs, rawName)
        const name = nfc(rawName)
        const rel = relDir ? `${relDir}/${name}` : name
        const rawRel = rawRelDir ? `${rawRelDir}/${rawName}` : rawName

        // Our own quarantine folder at the root is never scanned.
        if (!relDir && name.toLowerCase() === quarantineRel) continue
        if (name.startsWith('.dondu-')) continue
        if (excluder.excluded(rel)) continue

        let st: import('node:fs').Stats
        try {
          st = await fs.lstat(longPath(abs))
        } catch {
          continue
        }

        const cloudReal = plat.cloudPlaceholderRealName(name)
        const hidden = name.startsWith('.') && !cloudReal
        if (hidden && !scan.includeHidden) continue

        let kind: FileKind
        if (st.isSymbolicLink()) kind = 'symlink'
        else if (st.isDirectory()) kind = 'dir'
        else if (st.isFile()) kind = 'file'
        else continue // sockets, devices…

        const displayName = cloudReal ?? name
        const { ext } = splitExt(displayName)
        let family: FileFamily = familyOf(ext)

        if (kind === 'dir') {
          if (await isAppleBundle(abs, ext)) {
            kind = 'bundle'
            bundleTypes.set(dirKey(root, rel), 'apple')
          } else if (scan.treatProjectFoldersAsUnit) {
            let children: string[] = []
            try {
              children = await fs.readdir(longPath(abs))
            } catch {
              /* unreadable */
            }
            if (isProject(children)) {
              kind = 'bundle'
              family = 'code'
              bundleTypes.set(dirKey(root, rel), 'project')
            }
          }
        }

        if (kind === 'file' || kind === 'bundle') {
          hist[ext || '(yok)'] = (hist[ext || '(yok)'] ?? 0) + 1
          if (kind === 'file' && enabledFamilies[family] === false) continue
        } else if (kind === 'dir') subfolders++

        const placeholder = !!cloudReal || placeholders.has(nfc(abs))
        const relPath = cloudReal ? (relDir ? `${relDir}/${cloudReal}` : cloudReal) : rel
        push({
          id: randomUUID(),
          sessionId: opts.sessionId,
          root,
          relPath,
          relPathRaw: rawRel !== relPath ? rawRel : undefined,
          name: displayName,
          ext,
          kind,
          family,
          size: kind === 'file' ? st.size : 0,
          mtime: Math.round(st.mtimeMs),
          ctime: Math.round(st.birthtimeMs || st.ctimeMs),
          isHidden: hidden,
          isCloudPlaceholder: placeholder,
          isLocked: false,
          sensitive: false,
        })
        if (found % 200 === 0) {
          opts.onProgress?.(found, abs)
          await yieldToLoop()
        }

        if (kind === 'dir' && depth < scan.maxDepth) await visit(abs, depth + 1)
      }
      if (relDir) dirContents.set(dirKey(root, relDir), { contents: hist, subfolders })
    }

    await visit(root, 1)
    flush()
  }
  opts.onProgress?.(found, '')
  return { found, bundleTypes, dirContents }
}

/** Key for per-directory maps that must stay unique across roots. */
export function dirKey(root: string, rel: string): string {
  return `${root}\u0000${rel}`
}
