import type { ContentKind } from '@shared/kinds'
import type { FileMeta, FileRecord } from '@shared/types'
import { fold } from '../rules'
import {
  audioKind,
  captureTime,
  isContainerDirName,
  isGameAssetFile,
  isGameAssetName,
  isGenericDirName,
  screenshotDevice,
} from './signals'

/**
 * A unit is what gets placed as one piece (revision 1):
 * - folder: an existing, coherent folder (sound pack, asset pack, course, album) — never split
 * - event:  photos/videos taken close together in time (a wedding, a trip)
 * - file:   a loose file
 */
export interface Unit {
  id: string
  type: 'file' | 'folder' | 'event'
  root: string
  /** Inventory files that travel with this unit (for a folder: everything under it). */
  memberIds: string[]
  /** Folder units: the directory record that is moved. */
  dirId?: string
  /** Folder: its path; file: the file path; event: the folder the first member is in. */
  relPath: string
  /** Default display name (folder name, file name, event date). */
  label: string
  kindHint: ContentKind
  dateFrom?: number
  dateTo?: number
  /** Files whose thumbnails represent the unit (max 6). */
  sampleIds: string[]
}

export interface UnitSet {
  units: Unit[]
  /** fileId → unit id */
  unitOf: Map<string, string>
}

const EVENT_GAP_MS = 3 * 3600_000
const EVENT_MAX_SPAN_MS = 4 * 86_400_000
const EVENT_MIN_ITEMS = 5

const parentOf = (rel: string): string =>
  rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
const baseOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1)

/** Content kind of a single file from local signals (AI may refine it later). */
export function kindOf(f: FileRecord, meta: FileMeta): ContentKind {
  if (f.kind === 'bundle') {
    if (meta.bundleType === 'project') return 'code'
    if (f.ext === 'app') return 'installer'
    if (f.ext === 'key') return 'presentation'
    if (f.ext === 'numbers') return 'spreadsheet'
    if (f.ext === 'pages' || f.ext === 'rtfd') return 'document'
    return 'other'
  }
  switch (f.family) {
    case 'image': {
      const dev = screenshotDevice(f, meta)
      if (dev) return dev === 'phone' ? 'screenshot_phone' : 'screenshot_pc'
      if (meta.camera || meta.exifDate) return 'photo'
      if (['heic', 'heif', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raw'].includes(f.ext))
        return 'photo'
      if (
        /^(scan|camscanner|adobe scan|belge|document|doc|tarama|fatura|receipt|makbuz)/.test(
          fold(f.name),
        )
      )
        return 'document_photo'
      if (isGameAssetName(f.name)) return 'game_asset'
      return 'image'
    }
    case 'video':
      return /^(ekran kaydi|screen recording|nayton tallennus|bildschirmaufnahme)/.test(
        fold(f.name),
      )
        ? 'screen_recording'
        : 'video'
    case 'audio':
      return audioKind(f, meta)
    case 'document':
      return 'document'
    case 'text':
      return 'document'
    case 'spreadsheet':
      return 'spreadsheet'
    case 'presentation':
      return 'presentation'
    case 'installer':
      return 'installer'
    case 'archive':
      return 'archive'
    case 'book':
      return 'ebook'
    case 'code':
      return 'code'
    case 'design':
      return ['ttf', 'otf', 'woff', 'woff2'].includes(f.ext)
        ? 'font'
        : isGameAssetFile(f)
          ? 'game_asset'
          : 'design_asset'
    default:
      return isGameAssetFile(f) ? 'game_asset' : 'other'
  }
}

/** Dominant kind of a group of files (folder units). */
function dominantKind(
  files: FileRecord[],
  metas: Map<string, FileMeta>,
  name: string,
): ContentKind {
  const counts = new Map<ContentKind, number>()
  for (const f of files) {
    const k = kindOf(f, metas.get(f.id) ?? {})
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const top = sorted[0]
  // A homogeneous folder is what it contains (a pack of only sound effects is a sound pack).
  if (top && top[1] >= 0.8 * files.length) return top[0]
  const mixedMedia =
    files.some((f) => f.family === 'image') && files.some((f) => f.family === 'audio')
  if (isGameAssetName(name) || files.some(isGameAssetFile) || (mixedMedia && files.length >= 4))
    return 'game_asset'
  return top ? top[0] : 'other'
}

export function buildUnits(files: FileRecord[], metas: Map<string, FileMeta>): UnitSet {
  const units: Unit[] = []
  const unitOf = new Map<string, string>()
  const movable = files.filter(
    (f) => (f.kind === 'file' || f.kind === 'bundle') && !f.isCloudPlaceholder,
  )
  const dirs = files.filter((f) => f.kind === 'dir')

  // ---- folder units ------------------------------------------------------------------------
  // Files under each directory (recursive), per root.
  const under = new Map<string, FileRecord[]>()
  const key = (root: string, rel: string): string => `${root}\u0000${rel}`
  for (const f of movable) {
    let p = parentOf(f.relPath)
    while (p) {
      const k = key(f.root, p)
      const list = under.get(k)
      if (list) list.push(f)
      else under.set(k, [f])
      p = parentOf(p)
    }
  }
  const isUnitDir = (d: FileRecord): boolean => {
    const name = baseOf(d.relPath)
    const atTop = !d.relPath.includes('/')
    if (atTop && isContainerDirName(name)) return false
    if (isGenericDirName(name)) return false
    return (under.get(key(d.root, d.relPath))?.length ?? 0) >= 2
  }
  // Top-down: the first coherent folder on a path becomes the unit; deeper ones belong to it.
  const sortedDirs = [...dirs].sort(
    (a, b) => a.relPath.split('/').length - b.relPath.split('/').length,
  )
  const coveredDirs = new Set<string>()
  for (const d of sortedDirs) {
    const k = key(d.root, d.relPath)
    let p = parentOf(d.relPath)
    let insideUnit = false
    while (p) {
      if (coveredDirs.has(key(d.root, p))) {
        insideUnit = true
        break
      }
      p = parentOf(p)
    }
    if (insideUnit) {
      coveredDirs.add(k)
      continue
    }
    if (!isUnitDir(d)) continue
    coveredDirs.add(k)
    const members = under.get(k) ?? []
    const name = baseOf(d.relPath)
    const unit: Unit = {
      id: `d:${d.id}`,
      type: 'folder',
      root: d.root,
      memberIds: members.map((m) => m.id),
      dirId: d.id,
      relPath: d.relPath,
      label: name,
      kindHint: dominantKind(members, metas, name),
      sampleIds: members
        .filter((m) => m.family === 'image' && !m.sensitive)
        .slice(0, 3)
        .map((m) => m.id),
    }
    units.push(unit)
    for (const m of members) unitOf.set(m.id, unit.id)
  }

  // ---- event units -------------------------------------------------------------------------
  const loose = movable.filter((f) => !unitOf.has(f.id))
  const timed = loose
    .filter((f) => f.family === 'image' || f.family === 'video')
    .map((f) => ({ f, meta: metas.get(f.id) ?? {} }))
    .filter(({ f, meta }) => !screenshotDevice(f, meta))
    .map(({ f, meta }) => ({ f, t: captureTime(f, meta) }))
    .filter((x): x is { f: FileRecord; t: number } => x.t !== undefined)
    .sort((a, b) => a.t - b.t || a.f.relPath.localeCompare(b.f.relPath))
  {
    let cluster: { f: FileRecord; t: number }[] = []
    const flush = (): void => {
      if (
        cluster.length >= EVENT_MIN_ITEMS &&
        cluster[0]!.f.root === cluster[cluster.length - 1]!.f.root
      ) {
        const first = cluster[0]!
        const last = cluster[cluster.length - 1]!
        const unit: Unit = {
          id: `e:${first.f.id}`,
          type: 'event',
          root: first.f.root,
          memberIds: cluster.map((c) => c.f.id),
          relPath: parentOf(first.f.relPath),
          label: new Date(first.t).toISOString().slice(0, 10),
          kindHint: 'photo',
          dateFrom: first.t,
          dateTo: last.t,
          sampleIds: pickSamples(cluster.map((c) => c.f)),
        }
        units.push(unit)
        for (const c of cluster) unitOf.set(c.f.id, unit.id)
      }
      cluster = []
    }
    for (const x of timed) {
      const prev = cluster[cluster.length - 1]
      if (
        prev &&
        (x.t - prev.t > EVENT_GAP_MS ||
          x.t - cluster[0]!.t > EVENT_MAX_SPAN_MS ||
          x.f.root !== prev.f.root)
      )
        flush()
      cluster.push(x)
    }
    flush()
  }

  // ---- single files ------------------------------------------------------------------------
  for (const f of movable) {
    if (unitOf.has(f.id)) continue
    const meta = metas.get(f.id) ?? {}
    const unit: Unit = {
      id: `f:${f.id}`,
      type: 'file',
      root: f.root,
      memberIds: [f.id],
      relPath: f.relPath,
      label: f.name,
      kindHint: kindOf(f, meta),
      sampleIds: f.family === 'image' && !f.sensitive ? [f.id] : [],
    }
    units.push(unit)
    unitOf.set(f.id, unit.id)
  }
  units.sort(
    (a, b) => (a.root + a.relPath).localeCompare(b.root + b.relPath) || a.id.localeCompare(b.id),
  )
  return { units, unitOf }
}

/** Up to 6 photos spread across the event (first, last and evenly in between). */
function pickSamples(members: FileRecord[]): string[] {
  const imgs = members.filter((m) => m.family === 'image' && !m.sensitive)
  if (imgs.length <= 6) return imgs.map((m) => m.id)
  const out: string[] = []
  for (let i = 0; i < 6; i++) out.push(imgs[Math.round((i * (imgs.length - 1)) / 5)]!.id)
  return [...new Set(out)]
}
