import type { Settings } from '@shared/settings'
import type { FileRecord } from '@shared/types'
import { hamming } from '../hash'
import { fold } from '../rules'
import { splitExt } from '../scanner/types'

export interface DupeGroup {
  kind: 'exact' | 'near'
  keep: FileRecord
  others: FileRecord[]
}

export interface DupeResult {
  exact: DupeGroup[]
  near: DupeGroup[]
  /** HEIC/RAW + JPG pairs with the same stem in the same folder: fileId → partner fileId. */
  siblings: Map<string, string>
}

const dirOf = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')

/** Lower score = better candidate to keep. */
function keepScore(f: FileRecord, s: Settings['dupes']): (number | string)[] {
  const pathFolded = fold(`${f.root}/${f.relPath}`)
  const segs = pathFolded.split(/[\\/]/)
  const prefIdx = s.preferredFolderOrder.findIndex((p) => segs.includes(fold(p)))
  const pref = prefIdx === -1 ? 999 : prefIdx
  // Names that look like copies ("x (1).pdf", "x kopya", "copy of") are worse.
  const copyish = /(\(\d+\)|kopya|copy|kopie|kopio)/i.test(f.name) ? 1 : 0
  const depth = f.relPath.split('/').length
  switch (s.keepPolicy) {
    case 'oldest':
      return [f.mtime, copyish, depth, f.relPath]
    case 'newest':
      return [-f.mtime, copyish, depth, f.relPath]
    case 'shortestPath':
      return [depth, f.relPath.length, copyish, f.relPath]
    default:
      return [copyish, pref, f.mtime, depth, f.relPath]
  }
}

function cmp(a: (number | string)[], b: (number | string)[]): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

function pickKeep(group: FileRecord[], s: Settings['dupes']): DupeGroup['keep'] {
  return [...group].sort((a, b) => cmp(keepScore(a, s), keepScore(b, s)))[0]!
}

/** Exact duplicates by size + full hash; near duplicates (images) by dHash distance. */
export function findDuplicates(files: FileRecord[], settings: Settings): DupeResult {
  const s = settings.dupes
  const res: DupeResult = { exact: [], near: [], siblings: new Map() }
  const usable = files.filter(
    (f) => f.kind === 'file' && !f.isCloudPlaceholder && f.size >= Math.max(1, s.minSizeKB * 1024),
  )

  if (s.enabled) {
    const byHash = new Map<string, FileRecord[]>()
    for (const f of usable) {
      if (!f.hashFull) continue
      const k = `${f.size}:${f.hashFull}`
      byHash.set(k, [...(byHash.get(k) ?? []), f])
    }
    for (const g of [...byHash.values()].filter((x) => x.length > 1)) {
      const keep = pickKeep(g, s)
      res.exact.push({
        kind: 'exact',
        keep,
        others: g
          .filter((f) => f.id !== keep.id)
          .sort((a, b) => a.relPath.localeCompare(b.relPath)),
      })
    }
    res.exact.sort((a, b) => a.keep.relPath.localeCompare(b.keep.relPath))

    if (s.includeNearDuplicateImages) {
      const inExact = new Set(res.exact.flatMap((g) => g.others.map((o) => o.id)))
      const imgs = usable
        .filter((f) => f.family === 'image' && f.phash && !inExact.has(f.id))
        .sort((a, b) => a.relPath.localeCompare(b.relPath))
      const used = new Set<string>()
      const th = settings.images.nearDuplicateThreshold
      for (const a of imgs) {
        if (used.has(a.id)) continue
        const group = [a]
        for (const b of imgs) {
          if (b.id === a.id || used.has(b.id)) continue
          if (a.hashFull && a.hashFull === b.hashFull) continue
          if (hamming(a.phash!, b.phash!) <= th) group.push(b)
        }
        if (group.length > 1) {
          group.forEach((g) => used.add(g.id))
          const keep = pickKeep(group, s)
          res.near.push({ kind: 'near', keep, others: group.filter((g) => g.id !== keep.id) })
        }
      }
    }
  }

  if (settings.images.keepHeicJpgSiblingsTogether) {
    const RAWISH = new Set(['heic', 'heif', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'raw', 'orf', 'rw2'])
    const byKey = new Map<string, FileRecord[]>()
    for (const f of files) {
      if (f.kind !== 'file' || f.family !== 'image') continue
      const k = `${f.root}|${dirOf(f.relPath)}|${fold(splitExt(f.name).stem)}`
      byKey.set(k, [...(byKey.get(k) ?? []), f])
    }
    for (const g of byKey.values()) {
      const primary = g.find((f) => RAWISH.has(f.ext))
      if (!primary) continue
      for (const f of g) if (f.id !== primary.id) res.siblings.set(f.id, primary.id)
    }
  }
  return res
}
