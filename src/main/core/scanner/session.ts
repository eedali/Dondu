import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Settings } from '@shared/settings'
import type { FileMeta, FileRecord, ScanProgress, ScanSummary } from '@shared/types'
import type { Repos } from '../../db/repos'
import { dHashFromGray9x8 } from '../hash'
import type { TaskRunner } from '../pool'
import { joinRel, mergeRoots } from '../platform/paths'
import { detectSensitive } from '../rules/sensitive'
import { dirKey, walk } from './walker'

/** Produces thumbnails on the main thread (Electron nativeImage); injected for testability. */
export interface Thumbnailer {
  make(
    src: string,
    maxEdge: number,
    outFile: string,
  ): Promise<{ width?: number; height?: number; gray9x8?: Uint8Array } | null>
}

export interface ScanDeps {
  repos: Repos
  runner: TaskRunner
  thumbnailer?: Thumbnailer
  /** Directory for cached thumbnails (inside userData). */
  thumbsDir: string
  /** Post-processing hook (rules classification) run before the session is closed. */
  postProcess?: (sessionId: string) => Promise<void> | void
}

export interface ScanOptions {
  roots: string[]
  settings: Settings
  signal?: AbortSignal
  onProgress?: (p: ScanProgress) => void
  sessionId?: string
}

const THUMB_FAMILIES = new Set(['image', 'video'])

/** Full read-only scan: walk → analyze (worker pool) → thumbnails → duplicate hashing. */
export async function runScan(deps: ScanDeps, opts: ScanOptions): Promise<ScanSummary> {
  const { repos, runner } = deps
  const { settings, signal } = opts
  const roots = mergeRoots(opts.roots)
  const sessionId = opts.sessionId ?? randomUUID()
  const startedAt = Date.now()
  repos.sessions.create(sessionId, roots, settings)

  let found = 0
  let analyzed = 0
  let total = 0
  let lastEmit = 0
  const emit = (
    p: Partial<ScanProgress> & { phase: ScanProgress['phase'] },
    force = false,
  ): void => {
    const now = Date.now()
    if (!force && now - lastEmit < 100) return
    lastEmit = now
    opts.onProgress?.({ sessionId, found, analyzed, total, ...p })
  }

  try {
    // 1) Walk
    const walkRes = await walk({
      sessionId,
      roots,
      scan: settings.scan,
      quarantineFolderName: settings.quarantineFolderName,
      signal,
      onBatch: (records) => repos.files.insertMany(records),
      onProgress: (n, currentPath) => {
        found = n
        emit({ phase: 'walking', currentPath })
      },
    })
    found = walkRes.found
    if (signal?.aborted) return finish('cancelled')

    // Directory / bundle meta from the walk.
    const files = repos.files.bySession(sessionId)
    const dirMeta: { fileId: string; meta: FileMeta }[] = []
    for (const f of files) {
      if (f.kind !== 'dir' && f.kind !== 'bundle') continue
      const key = dirKey(f.root, f.relPath)
      const c = walkRes.dirContents.get(key)
      const meta: FileMeta = {}
      if (c) {
        meta.contents = c.contents
        meta.subfolders = c.subfolders
      }
      const bt = walkRes.bundleTypes.get(key)
      if (bt) meta.bundleType = bt
      if (Object.keys(meta).length) dirMeta.push({ fileId: f.id, meta })
    }
    repos.files.setMetaMany(dirMeta)

    // 2) Analyze
    const work = files.filter(
      (f) => (f.kind === 'file' || f.kind === 'bundle') && !f.isCloudPlaceholder,
    )
    total = work.length
    emit({ phase: 'analyzing' }, true)

    const maxContentBytes = settings.scan.maxFileSizeForContentMB * 1024 * 1024
    const sens = settings.sensitive
    const thumbEdge = settings.images.thumbnailMaxEdge
    const pendingUpdates: { id: string; patch: Parameters<Repos['files']['update']>[1] }[] = []
    const pendingMeta: { fileId: string; meta: FileMeta }[] = []
    const flush = (): void => {
      if (pendingUpdates.length) repos.files.updateMany(pendingUpdates.splice(0))
      if (pendingMeta.length) repos.files.setMetaMany(pendingMeta.splice(0))
    }
    if (deps.thumbnailer) await fs.mkdir(deps.thumbsDir, { recursive: true })

    const analyzeOne = async (f: FileRecord): Promise<void> => {
      const abs = joinRel(f.root, f.relPath)
      let res
      try {
        res = await runner.run({
          type: 'content',
          task: {
            abs,
            name: f.name,
            ext: f.ext,
            kind: f.kind,
            family: f.family,
            size: f.size,
            maxChars: settings.scan.maxTextExcerptChars,
            maxContentBytes,
          },
        })
      } catch (e) {
        pendingMeta.push({ fileId: f.id, meta: { error: (e as Error).message.slice(0, 200) } })
        return
      }
      const meta: FileMeta = { ...repos.files.getMeta(f.id), ...res.meta }
      const s = detectSensitive(
        {
          name: f.name,
          ext: f.ext,
          text: meta.textExcerpt,
          mime: res.mime,
          isBundle: f.kind === 'bundle',
        },
        {
          extraNamePatterns: sens.extraNamePatterns,
          extraExtensions: sens.extraExtensions,
          contentScan: sens.contentScan,
        },
      )
      const patch: Parameters<Repos['files']['update']>[1] = {
        mime: res.mime,
        family: res.family,
        hashFast: res.hashFast,
        sensitive: s.sensitive,
        sensitiveReason: s.reason,
      }
      if (s.sensitive) {
        // Sensitive: never persist excerpt or thumbnail (docs/03 §6).
        delete meta.textExcerpt
      } else if (
        deps.thumbnailer &&
        settings.cache.thumbnails &&
        (THUMB_FAMILIES.has(res.family) || f.ext === 'pdf' || res.thumbSource) &&
        (f.size <= maxContentBytes || f.kind === 'bundle')
      ) {
        const key = res.hashFast ?? f.id
        const out = path.join(deps.thumbsDir, `${key}.jpg`)
        try {
          const t = await deps.thumbnailer.make(res.thumbSource ?? abs, thumbEdge, out)
          if (t) {
            meta.thumbPath = out
            if (t.width && !meta.width) meta.width = t.width
            if (t.height && !meta.height) meta.height = t.height
            if (t.gray9x8 && res.family === 'image') patch.phash = dHashFromGray9x8(t.gray9x8)
          }
        } catch {
          /* thumbnail is optional */
        }
      }
      pendingUpdates.push({ id: f.id, patch })
      pendingMeta.push({ fileId: f.id, meta })
      if (f.kind === 'bundle' && res.size) {
        // bundle size is computed during analysis
        repos.db.prepare('UPDATE files SET size = ? WHERE id = ?').run([res.size, f.id])
      }
    }

    const concurrency = Math.max(2, runner.size * 2)
    let next = 0
    const workers = Array.from({ length: concurrency }, async () => {
      while (next < work.length) {
        if (signal?.aborted) return
        const f = work[next++]!
        await analyzeOne(f)
        analyzed++
        if (pendingUpdates.length >= 500) flush()
        emit({ phase: 'analyzing', currentPath: path.join(f.root, f.relPath) })
      }
    })
    await Promise.all(workers)
    flush()
    if (signal?.aborted) return finish('cancelled')

    // 3) Full hash for duplicate candidates (same size + same fast hash).
    if (settings.dupes.enabled) {
      const minSize = Math.max(1, settings.dupes.minSizeKB * 1024)
      const fresh = repos.files
        .bySession(sessionId)
        .filter(
          (f) => f.kind === 'file' && !f.isCloudPlaceholder && f.size >= minSize && f.hashFast,
        )
      const groups = new Map<string, FileRecord[]>()
      for (const f of fresh) {
        const k = `${f.size}:${f.hashFast}`
        groups.set(k, [...(groups.get(k) ?? []), f])
      }
      const cands = [...groups.values()].filter((g) => g.length > 1).flat()
      total = cands.length
      analyzed = 0
      emit({ phase: 'hashing' }, true)
      const updates: { id: string; patch: { hashFull: string } }[] = []
      await Promise.all(
        cands.map(async (f) => {
          if (signal?.aborted) return
          try {
            const h = await runner.run({ type: 'fullHash', path: joinRel(f.root, f.relPath) })
            updates.push({ id: f.id, patch: { hashFull: h } })
          } catch {
            /* unreadable: not a duplicate candidate */
          }
          analyzed++
          emit({ phase: 'hashing', currentPath: f.relPath })
        }),
      )
      repos.files.updateMany(updates)
      if (signal?.aborted) return finish('cancelled')
    }

    await deps.postProcess?.(sessionId)
    return finish('done')
  } catch (e) {
    emit({ phase: 'error', message: (e as Error).message }, true)
    repos.sessions.finish(sessionId, 'error')
    throw e
  }

  function finish(status: 'done' | 'cancelled'): ScanSummary {
    repos.sessions.finish(sessionId, status)
    emit({ phase: status === 'done' ? 'done' : 'cancelled' }, true)
    return summarize(repos, sessionId, roots, startedAt, status)
  }
}

export function summarize(
  repos: Repos,
  sessionId: string,
  roots: string[],
  startedAt: number,
  status: ScanSummary['status'],
): ScanSummary {
  const files = repos.files.bySession(sessionId)
  const byFamily: ScanSummary['byFamily'] = {}
  let totalBytes = 0
  let totalFiles = 0
  let cloud = 0
  let bundles = 0
  let sensitive = 0
  for (const f of files) {
    if (f.kind === 'dir' || f.kind === 'symlink') continue
    totalFiles++
    totalBytes += f.size
    const fam = (byFamily[f.family] ??= { count: 0, bytes: 0 })
    fam.count++
    fam.bytes += f.size
    if (f.isCloudPlaceholder) cloud++
    if (f.kind === 'bundle') bundles++
    if (f.sensitive) sensitive++
  }
  return {
    sessionId,
    roots,
    startedAt,
    finishedAt: Date.now(),
    status,
    totalFiles,
    totalBytes,
    byFamily,
    cloudPlaceholders: cloud,
    bundles,
    sensitive,
  }
}
