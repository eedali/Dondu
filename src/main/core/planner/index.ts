import path from 'node:path'
import type { Settings } from '@shared/settings'
import type {
  AIClassifyOutput,
  Category,
  FileMeta,
  FileRecord,
  ItemFlag,
  Plan,
  PlanAction,
  PlanItem,
  PlanSummary,
} from '@shared/types'
import { findDuplicates } from '../dupes'
import {
  expandFolder,
  expandName,
  isGenericName,
  sanitizeFileName,
  sanitizeSegment,
  uniquePath,
} from '../naming'
import { absOf, isInside, pathKey } from '../platform/paths'
import type { Correction } from '../../db/repos'
import { classifyFile, dateFromName, namePattern, type RuleResult } from '../rules'
import { splitExt } from '../scanner/types'
import type { Organization, Placement } from '../organize'

export interface PlannerInput {
  planId: string
  sessionId: string
  roots: string[]
  files: FileRecord[]
  metas: Map<string, FileMeta>
  settings: Settings
  categories: Category[]
  /** AI classifications by file id (phase 3). */
  ai?: Map<string, AIClassifyOutput>
  /** User corrections (ext + name pattern → category), newest first. */
  corrections?: Correction[]
  /** Fixed "now" for determinism in tests. */
  now?: number
  /** Disk existence check for collision handling (read-only). */
  exists?: (p: string) => boolean
  /** Revision 1: units and their placements (rules and/or AI). */
  organization?: Organization
}

const PHOTO_CATS = new Set(['photos'])

/** Label for the quarantine sub-folder of this plan: 2026-10-15_1930. */
export function quarantineLabel(now: number): string {
  const d = new Date(now)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

function decide(
  rule: RuleResult,
  ai: AIClassifyOutput | undefined,
  validCats: Set<string>,
): {
  category: string
  confidence: number
  reason: string
  source: 'rule' | 'ai'
  subcategory?: string
} {
  if (
    ai &&
    validCats.has(ai.category) &&
    (ai.confidence >= rule.confidence || rule.category === 'uncertain')
  ) {
    return {
      category: ai.category,
      confidence: ai.confidence,
      reason: ai.reason || rule.reason,
      source: 'ai',
      subcategory: ai.subcategory,
    }
  }
  return {
    category: rule.category,
    confidence: rule.confidence,
    reason: rule.reason,
    source: 'rule',
  }
}

function parseYm(s?: string): { year: number; month?: number } | undefined {
  if (!s) return undefined
  const m = /^(\d{4})(?:-(\d{2}))?/.exec(s)
  if (!m) return undefined
  return { year: Number(m[1]), month: m[2] ? Number(m[2]) : undefined }
}

/**
 * Builds a deterministic plan from inventory + settings + taxonomy (docs/02 §6.3). Read-only:
 * never touches the file system except existence checks for collision suffixes.
 */
export function buildPlan(input: PlannerInput): Plan {
  const { settings, files, metas } = input
  const now = input.now ?? Date.now()
  const exists = input.exists ?? (() => false)
  const qLabel = quarantineLabel(now)
  const cats = new Map(input.categories.filter((c) => c.enabled).map((c) => [c.id, c]))
  const validCats = new Set(cats.keys())
  const lowTh = settings.report.lowConfidenceThreshold

  // Target root per source root.
  const targetRootFor = (root: string): string => {
    if (settings.targetMode === 'singleTarget' && settings.targetRoot) {
      const tr = settings.targetRoot
      if (input.roots.some((r) => isInside(tr, r))) return tr
    }
    return root
  }
  const quarantineDir = (root: string): string =>
    path.join(root, sanitizeSegment(settings.quarantineFolderName), qLabel)

  const org = input.organization
  const fileById = new Map(files.map((f) => [f.id, f]))
  // Folder units travel as one piece: their files never get items of their own (revision 1).
  const folderUnits = org ? [...org.units.values()].filter((u) => u.type === 'folder') : []
  const coveredByFolder = new Set<string>()
  for (const u of folderUnits) for (const id of u.memberIds) coveredByFolder.add(id)
  const placementOf = (f: FileRecord): Placement | undefined => {
    const uid = org?.set.unitOf.get(f.id)
    return uid ? org?.placements.get(uid) : undefined
  }

  const candidates = files
    .filter((f) => (f.kind === 'file' || f.kind === 'bundle') && !coveredByFolder.has(f.id))
    .sort((a, b) => (a.root + '\0' + a.relPath).localeCompare(b.root + '\0' + b.relPath))

  const dupes = findDuplicates(candidates, settings)
  const dupOf = new Map<string, { keep: FileRecord; kind: 'exact' | 'near' }>()
  for (const g of dupes.exact)
    for (const o of g.others) dupOf.set(o.id, { keep: g.keep, kind: 'exact' })
  for (const g of dupes.near)
    for (const o of g.others) dupOf.set(o.id, { keep: g.keep, kind: 'near' })

  // Photo events (images.groupBy = 'event'): >3h gap starts a new event.
  const eventOf = new Map<string, string>()
  if (settings.images.groupBy === 'event') {
    const photos = candidates
      .map((f) => ({ f, t: Date.parse(metas.get(f.id)?.exifDate ?? '') || f.mtime }))
      .filter(({ f }) => f.family === 'image')
      .sort((a, b) => a.t - b.t)
    let start = 0
    let last = -Infinity
    for (const p of photos) {
      if (p.t - last > 3 * 3600_000) start = p.t
      last = p.t
      eventOf.set(p.f.id, new Date(start).toISOString().slice(0, 10))
    }
  }

  const items: PlanItem[] = []
  const taken = new Set<string>()
  const decided = new Map<string, { category: string; dir: string }>()
  let idSeq = 0
  const nextId = (): string => `${input.planId.slice(0, 8)}-${String(++idSeq).padStart(5, '0')}`

  const push = (
    f: FileRecord,
    p: Omit<
      PlanItem,
      'id' | 'planId' | 'fileId' | 'sourcePath' | 'userEdited' | 'size' | 'sensitive' | 'thumbPath'
    >,
  ): void => {
    items.push({
      id: nextId(),
      planId: input.planId,
      fileId: f.id,
      sourcePath: absOf(f),
      userEdited: false,
      ...p,
    })
  }

  // Siblings (JPG next to HEIC) follow their primary: plan primaries first.
  const ordered = [
    ...candidates.filter((f) => !dupes.siblings.has(f.id)),
    ...candidates.filter((f) => dupes.siblings.has(f.id)),
  ]

  for (const f of ordered) {
    const meta = metas.get(f.id) ?? {}
    const src = absOf(f)
    const flags: ItemFlag[] = []
    if (f.kind === 'bundle') flags.push(meta.bundleType === 'project' ? 'project' : 'bundle')

    // Never touched: cloud placeholders and the Photos library.
    if (f.isCloudPlaceholder) {
      push(f, {
        action: 'skip',
        targetPath: src,
        category: f.ruleCategory ?? 'uncertain',
        confidence: 1,
        reason: 'Bulutta, indirilmemiş — dokunulmadı.',
        source: 'rule',
        enabled: false,
        groupKey: '__cloud',
        flags: [...flags, 'cloud'],
      })
      continue
    }
    if (f.ext === 'photoslibrary') {
      push(f, {
        action: 'skip',
        targetPath: src,
        category: 'photos',
        confidence: 1,
        reason: 'Fotoğraflar uygulamasının kitaplığı — dokunulmadı.',
        source: 'rule',
        enabled: false,
        groupKey: '__skip',
        flags,
      })
      continue
    }

    let rule = classifyFile(f, meta, settings)
    // Learning from corrections (docs/03 §9): same extension + name pattern → the user's choice.
    const corr = input.corrections?.find(
      (c) =>
        c.ext === f.ext && c.namePattern === namePattern(f.name) && validCats.has(c.newCategory),
    )
    if (corr && corr.newCategory !== rule.category)
      rule = {
        ...rule,
        category: corr.newCategory,
        confidence: 0.9,
        reason: 'Benzer dosyaları daha önce siz buraya koydunuz.',
      }
    let d = decide(rule, input.ai?.get(f.id), validCats)
    const aiOut = input.ai?.get(f.id)
    const sensitive = f.sensitive || !!aiOut?.sensitive || !!placementOf(f)?.sensitive
    if (sensitive) {
      flags.push('sensitive')
      const target = validCats.has(settings.sensitive.targetCategory)
        ? settings.sensitive.targetCategory
        : 'docs_personal_id'
      // Photos stay photos even when sensitive (e.g. GPS); documents go to the personal folder.
      if (!(f.family === 'image' && PHOTO_CATS.has(d.category))) {
        d = {
          ...d,
          category: target,
          confidence: Math.max(d.confidence, 0.85),
          reason: `Hassas: ${f.sensitiveReason ?? 'yapay zekâ işaretledi'}. ${d.reason}`,
        }
      }
    }

    // Duplicates → quarantine (exact enabled by default; near duplicates skipped by default).
    const dup = dupOf.get(f.id)
    // Very similar images (bursts, edits) are NOT left behind: they travel with their group and
    // are only flagged. Exact copies go to quarantine.
    if (dup?.kind === 'near') {
      flags.push('near_duplicate')
    }
    if (dup?.kind === 'exact' && settings.dupes.action !== 'reportOnly') {
      const qRoot = quarantineDir(f.root)
      const target = uniquePath(path.join(qRoot, ...f.relPath.split('/')), taken, exists)
      taken.add(pathKey(target))
      const action: PlanAction = settings.dupes.action === 'trash' ? 'trash' : 'quarantine'
      push(f, {
        action,
        targetPath: action === 'trash' ? src : target,
        category: d.category,
        confidence: dup.kind === 'exact' ? 1 : 0.7,
        reason:
          dup.kind === 'exact'
            ? `Birebir kopya; tutulan: ${dup.keep.relPath}`
            : `Çok benzer görsel; tutulan: ${dup.keep.relPath}`,
        source: 'rule',
        enabled: dup.kind === 'exact',
        groupKey: dup.kind === 'exact' ? '__dupes' : '__near',
        flags: [...flags, dup.kind === 'exact' ? 'duplicate' : 'near_duplicate'],
        duplicateOf: dup.keep.id,
      })
      continue
    }

    // Revision 1: a unit placement (rules or AI) decides the folder. Junk and sensitive files that
    // only the rules saw keep the classic handling.
    const rawPlacement = placementOf(f)
    const placement =
      rawPlacement &&
      rule.category !== 'junk' &&
      !(sensitive && rawPlacement.source === 'rule' && !PHOTO_CATS.has(d.category))
        ? rawPlacement
        : undefined
    const unit = placement ? org?.units.get(placement.unitId) : undefined
    if (placement) {
      d = {
        category: placement.kind,
        confidence: placement.confidence,
        reason: sensitive
          ? `Hassas: ${f.sensitiveReason ?? 'işaretli'}. ${placement.reason}`
          : placement.reason,
        source: placement.source,
        subcategory: placement.topic,
      }
      if (unit?.type === 'event') flags.push('event')
    }

    const cat = cats.get(d.category) ?? cats.get('uncertain')
    const catName = cat?.nameTr ?? d.category
    const exif = parseYm(meta.exifDate)
    const date = (settings.images.useExifDateForFolder && exif) ||
      parseYm(aiOut?.dateHint) ||
      rule.date ||
      dateFromName(f.name) || {
        year: new Date(f.mtime).getFullYear(),
        month: new Date(f.mtime).getMonth() + 1,
      }

    let tpl = cat?.folderTemplate ?? 'Gözden Geçir'
    if (d.category === 'screenshots') tpl = settings.images.screenshotTarget || tpl
    if (d.category === 'photos') {
      if (settings.images.groupBy === 'year') tpl = tpl.replace(/\/?\{Ay\}/i, '')
      if (settings.images.groupBy === 'event') tpl = tpl.replace(/\{Ay\}/i, '{Etkinlik}')
    }

    // Sibling: same folder as its primary.
    const primaryId = dupes.siblings.get(f.id)
    const primary = primaryId ? decided.get(primaryId) : undefined
    const tRoot = targetRootFor(f.root)
    const rootName = path.basename(f.root)
    const relDir = primary
      ? primary.dir
      : placement
        ? placement.relDir
        : expandFolder(tpl, {
            year: date.year,
            month: date.month,
            category: catName,
            rootName,
            event: eventOf.get(f.id),
          })
    if (primary) flags.push('sibling')
    decided.set(f.id, { category: primary?.category ?? d.category, dir: relDir })

    // Rename (off by default).
    let newName = sanitizeFileName(f.name)
    let suggestedName: string | undefined
    const rn = settings.rename
    const isPhoto =
      f.family === 'image' && (d.category === 'photos' || d.category === 'screenshots')
    if (
      rn.enabled &&
      f.kind === 'file' &&
      d.confidence >= rn.minConfidence &&
      (!rn.onlyGenericNames || isGenericName(f.name)) &&
      (!isPhoto || rn.photos)
    ) {
      const title = aiOut?.suggestedName || meta.title
      if (title) {
        const dateStr = `${date.year}-${String(date.month ?? 1).padStart(2, '0')}-${String(
          new Date(f.mtime).getDate(),
        ).padStart(2, '0')}`
        const candidate = expandName(
          rn.template,
          {
            date: dateStr,
            title: title.slice(0, 60),
            orig: splitExt(f.name).stem,
            year: date.year,
            month: date.month,
          },
          f.ext ? f.name.slice(-f.ext.length) : '',
        )
        if (candidate !== f.name) {
          newName = candidate
          suggestedName = candidate
        }
      }
    }

    const lowConf = d.confidence < lowTh || d.category === 'uncertain'
    const isJunk = d.category === 'junk'
    if (lowConf) flags.push('low_confidence')
    if (isJunk) flags.push('junk')

    let target = path.join(tRoot, ...relDir.split('/').filter(Boolean), newName)
    const srcDirKey = pathKey(path.dirname(src))
    const sameDir = pathKey(path.dirname(target)) === srcDirKey
    const sameName = newName === f.name.normalize('NFC') || newName === f.name

    if (sameDir && sameName) {
      push(f, {
        action: 'skip',
        targetPath: src,
        category: d.category,
        subcategory: d.subcategory,
        confidence: d.confidence,
        reason: `Zaten yerinde. ${d.reason}`,
        source: d.source,
        enabled: false,
        groupKey: '__inplace',
        flags,
      })
      continue
    }

    if (pathKey(target) !== pathKey(src)) {
      target = uniquePath(target, taken, (p) => pathKey(p) !== pathKey(src) && exists(p))
    }
    taken.add(pathKey(target))
    const action: PlanAction = sameDir ? 'rename' : sameName ? 'move' : 'move_rename'
    const enabled = !lowConf && !isJunk && !(sensitive && settings.sensitive.skipByDefault)
    if (/icloud|mobile documents/i.test(f.root) && !isInside(target, f.root))
      flags.push('leaves_icloud')

    push(f, {
      action,
      targetPath: target,
      category: decided.get(f.id)!.category,
      subcategory: d.subcategory,
      suggestedName,
      confidence: d.confidence,
      reason: primary ? `HEIC/RAW kardeşiyle aynı yere. ${d.reason}` : d.reason,
      source: d.source,
      enabled,
      groupKey: `${tRoot}|${relDir}`,
      flags,
      unitId: unit?.id,
      unitTitle: placement?.title,
      topic: placement?.topic,
      duplicateOf: dup?.kind === 'near' ? dup.keep.id : undefined,
    })
  }

  // Folder units: one item for the whole folder (move or keep in place).
  for (const u of folderUnits) {
    const dir = u.dirId ? fileById.get(u.dirId) : undefined
    if (!dir) continue
    const p = org?.placements.get(u.id)
    const src = absOf(dir)
    const flags: ItemFlag[] = ['folder_unit']
    if (u.memberIds.some((id) => fileById.get(id)?.sensitive)) flags.push('sensitive')
    const base = {
      category: p?.kind ?? u.kindHint,
      subcategory: p?.topic,
      confidence: p?.confidence ?? 0.9,
      source: p?.source ?? ('rule' as const),
      unitId: u.id,
      unitTitle: p?.title ?? u.label,
      topic: p?.topic,
    }
    const tRoot = targetRootFor(dir.root)
    const target = p
      ? path.join(tRoot, ...p.relDir.split('/').filter(Boolean), sanitizeSegment(dir.name))
      : src
    const keep =
      !p ||
      p.keepInPlace ||
      settings.organize.existingFolders === 'keep' ||
      pathKey(path.dirname(target)) === pathKey(path.dirname(src))
    if (keep) {
      items.push({
        id: nextId(),
        planId: input.planId,
        fileId: dir.id,
        sourcePath: src,
        userEdited: false,
        action: 'skip',
        targetPath: src,
        reason:
          p && !p.keepInPlace && settings.organize.existingFolders !== 'keep'
            ? `Zaten yerinde. ${p.reason}`
            : (p?.reason ?? 'Derli toplu klasör; olduğu gibi bırakıldı.'),
        enabled: false,
        groupKey: '__folders',
        flags,
        ...base,
      })
      continue
    }
    const finalTarget = uniquePath(target, taken, (x) => pathKey(x) !== pathKey(src) && exists(x))
    taken.add(pathKey(finalTarget))
    const lowConf = base.confidence < lowTh
    if (lowConf) flags.push('low_confidence')
    items.push({
      id: nextId(),
      planId: input.planId,
      fileId: dir.id,
      sourcePath: src,
      userEdited: false,
      action: 'move',
      targetPath: finalTarget,
      reason: `${p.reason} (${u.memberIds.length} dosya, bölünmeden)`,
      enabled: !lowConf,
      groupKey: `${tRoot}|${p.relDir}`,
      flags,
      ...base,
    })
  }

  // Deterministic order: by group, then source path.
  items.sort(
    (a, b) => a.groupKey.localeCompare(b.groupKey) || a.sourcePath.localeCompare(b.sourcePath),
  )

  return {
    id: input.planId,
    sessionId: input.sessionId,
    createdAt: now,
    status: 'draft',
    roots: input.roots,
    items,
    summary: summarizePlan(items, files, qLabel),
  }
}

export function summarizePlan(
  items: PlanItem[],
  files: FileRecord[] | Map<string, FileRecord>,
  quarantineLabel?: string,
): PlanSummary {
  const byId = files instanceof Map ? files : new Map(files.map((f) => [f.id, f]))
  const s: PlanSummary = {
    total: items.length,
    move: 0,
    rename: 0,
    quarantine: 0,
    trash: 0,
    skip: 0,
    sensitive: 0,
    duplicates: 0,
    review: 0,
    bytes: 0,
    quarantineLabel,
  }
  for (const it of items) {
    if (it.flags.includes('sensitive')) s.sensitive++
    if (it.flags.includes('duplicate') || it.flags.includes('near_duplicate')) s.duplicates++
    if (it.flags.includes('low_confidence')) s.review++
    if (!it.enabled || it.action === 'skip') {
      s.skip++
      continue
    }
    s.bytes += byId.get(it.fileId)?.size ?? 0
    if (it.action === 'move' || it.action === 'move_rename') s.move++
    if (it.action === 'rename' || it.action === 'move_rename') s.rename++
    if (it.action === 'quarantine') s.quarantine++
    if (it.action === 'trash') s.trash++
  }
  return s
}
