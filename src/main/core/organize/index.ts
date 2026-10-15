import type { ContentKind } from '@shared/kinds'
import type { Settings } from '@shared/settings'
import type { FileMeta, FileRecord } from '@shared/types'
import { expandFolder } from '../naming'
import { buildUnits, type Unit, type UnitSet } from './units'

export type { Unit, UnitSet } from './units'

/** Where a unit goes (revision 1). Paths are relative to the unit's (target) root. */
export interface Placement {
  unitId: string
  /** Target folder relative to the root ('' = the root itself). */
  relDir: string
  kind: ContentKind
  title: string
  topic?: string
  confidence: number
  reason: string
  source: 'rule' | 'ai'
  /** Folder units: leave the folder exactly where it is. */
  keepInPlace?: boolean
  /** The AI judged it sensitive (ID photo …): it stays local from now on. */
  sensitive?: boolean
}

export interface Organization {
  set: UnitSet
  units: Map<string, Unit>
  /** unit id → placement; units without one fall back to the classic per-file rules. */
  placements: Map<string, Placement>
}

const yearOf = (t: number): number => new Date(t).getFullYear()

const TR_MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
]

export function eventTitle(u: Unit): string {
  const d = new Date(u.dateFrom ?? 0)
  return `${d.getDate()} ${TR_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * Screenshot folder from the template; `{Cihaz}` becomes Telefon/Bilgisayar. Older templates
 * without `{Cihaz}` get the device as a sub-folder of their first segment.
 */
export function screenshotFolder(tpl: string, device: 'phone' | 'pc', year: number): string {
  const name = device === 'phone' ? 'Telefon' : 'Bilgisayar'
  const t = /\{cihaz\}/i.test(tpl)
    ? tpl
    : tpl.includes('/')
      ? tpl.replace('/', '/{Cihaz}/')
      : `${tpl}/{Cihaz}`
  return expandFolder(t.replace(/\{cihaz\}/gi, name), { year })
}

/**
 * Rules-only placement (no AI, "type" style): keeps coherent folders intact, groups events,
 * splits screenshots by device and sounds by kind. Everything else keeps the classic categories.
 */
export function rulePlacement(
  u: Unit,
  files: Map<string, FileRecord>,
  settings: Settings,
): Placement | undefined {
  const first = files.get(u.memberIds[0] ?? '')
  const base = { unitId: u.id, kind: u.kindHint, title: u.label, source: 'rule' as const }
  if (u.type === 'folder') {
    const parent = u.relPath.includes('/') ? u.relPath.slice(0, u.relPath.lastIndexOf('/')) : ''
    return {
      ...base,
      relDir: parent,
      keepInPlace: true,
      confidence: 0.9,
      reason: `Derli toplu klasör (${u.memberIds.length} dosya); bölünmeden korunuyor.`,
    }
  }
  if (u.type === 'event') {
    const year = yearOf(u.dateFrom ?? 0)
    return {
      ...base,
      title: eventTitle(u),
      relDir: expandFolder(`Fotoğraflar/{Yıl}/${u.label}`, { year }),
      confidence: 0.9,
      reason: `Aynı zaman aralığında çekilmiş ${u.memberIds.length} fotoğraf/video bir arada.`,
    }
  }
  if (!first) return undefined
  const year = new Date(first.mtime).getFullYear()
  switch (u.kindHint) {
    case 'screenshot_phone':
    case 'screenshot_pc':
      if (!settings.images.detectScreenshots) return undefined
      return {
        ...base,
        relDir: screenshotFolder(
          settings.images.screenshotTarget,
          u.kindHint === 'screenshot_phone' ? 'phone' : 'pc',
          year,
        ),
        confidence: 0.95,
        reason:
          u.kindHint === 'screenshot_phone'
            ? 'Telefon ekran görüntüsü.'
            : 'Bilgisayar ekran görüntüsü.',
      }
    case 'sound_effect':
      return { ...base, relDir: 'Ses Efektleri', confidence: 0.9, reason: 'Kısa ses efekti.' }
    case 'voice_note':
      return { ...base, relDir: 'Sesli Notlar', confidence: 0.9, reason: 'Ses kaydı / sesli not.' }
    case 'music':
      return { ...base, relDir: 'Müzik', confidence: 0.9, reason: 'Müzik dosyası.' }
    case 'game_asset':
      return {
        ...base,
        relDir: 'Oyun Geliştirme/Varlıklar',
        confidence: 0.8,
        reason: 'Oyun varlığı (asset).',
      }
    case 'document_photo':
      return {
        ...base,
        relDir: 'Belgeler/Belge Fotoğrafları',
        confidence: 0.75,
        reason: 'Belge fotoğrafı / taraması.',
      }
    default:
      return undefined
  }
}

/** Units + rule placements. The AI passes (revision 1b/1c) replace placements unit by unit. */
export function organizeWithRules(
  files: FileRecord[],
  metas: Map<string, FileMeta>,
  settings: Settings,
): Organization {
  const set = buildUnits(files, metas)
  const byId = new Map(files.map((f) => [f.id, f]))
  const placements = new Map<string, Placement>()
  for (const u of set.units) {
    const p = rulePlacement(u, byId, settings)
    if (p) placements.set(u.id, p)
  }
  return { set, units: new Map(set.units.map((u) => [u.id, u])), placements }
}
