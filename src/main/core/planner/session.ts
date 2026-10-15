import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import type { Settings } from '@shared/settings'
import type { AIClassifyOutput, Plan, PlanItem, PlanItemPatch } from '@shared/types'
import type { Repos } from '../../db/repos'
import { sanitizeFileName, sanitizeRelDir } from '../naming'
import { isInsideAny, pathKey } from '../platform/paths'
import { namePattern } from '../rules'
import { buildPlan, summarizePlan } from '.'
import { organizeWithRules, type Organization } from '../organize'
import path from 'node:path'
import { isContentKind } from '@shared/kinds'

/** Builds and stores a draft plan for a scan session. */
export function planFromSession(
  repos: Repos,
  sessionId: string,
  settings: Settings,
  ai?: Map<string, AIClassifyOutput>,
  aiSummary?: Plan['summary']['ai'],
  organization?: Organization,
): Plan {
  const session = repos.sessions.get(sessionId)
  if (!session) throw new Error('scan session not found')
  const files = repos.files.bySession(sessionId)
  const metas = repos.files.metaBySession(sessionId)
  const plan = buildPlan({
    planId: randomUUID(),
    sessionId,
    roots: session.roots,
    files,
    metas,
    // Revision 1: units are always built (rules); the AI passes refine their placements.
    organization: organization ?? organizeWithRules(files, metas, settings),
    settings,
    categories: repos.categories.all(),
    ai,
    corrections: settings.ai.learnFromCorrections ? repos.corrections.recent(200) : [],
    exists: (p) => fs.existsSync(p),
  })
  if (aiSummary) plan.summary.ai = aiSummary
  repos.plans.save(plan)
  return plan
}

/**
 * Edits items of a draft plan (target folder, name, skip, category, sensitive). Approved plans
 * are immutable — callers must duplicate them first.
 */
export function updatePlanItems(
  repos: Repos,
  planId: string,
  itemIds: string[],
  patch: PlanItemPatch,
  learn = true,
): Plan {
  const plan = repos.plans.get(planId)
  if (!plan) throw new Error('plan not found')
  if (plan.status !== 'draft') throw new Error('plan_not_draft')
  const ids = new Set(itemIds)
  const files = new Map(repos.files.bySession(plan.sessionId).map((f) => [f.id, f]))
  const categories = new Map(repos.categories.all().map((c) => [c.id, c]))

  for (const it of plan.items) {
    if (!ids.has(it.id)) continue
    const before: PlanItem = { ...it }
    if (patch.enabled !== undefined) it.enabled = patch.enabled
    const newTarget =
      patch.targetPath ??
      (patch.targetDir !== undefined &&
      it.action !== 'quarantine' &&
      it.action !== 'trash' &&
      !it.flags.includes('cloud')
        ? path.join(patch.targetDir, path.basename(it.targetPath))
        : undefined)
    if (newTarget !== undefined) {
      const t = path.resolve(newTarget)
      if (!isInsideAny(t, plan.roots)) throw new Error('target_outside_roots')
      const root = plan.roots.find((r) => isInsideAny(t, [r]))!
      const safeRel = sanitizeRelDir(path.relative(root, path.dirname(t)))
      it.targetPath = path.join(
        root,
        ...safeRel.split('/').filter(Boolean),
        sanitizeFileName(path.basename(t)),
      )
      if (it.action === 'skip') it.action = 'move'
      it.groupKey = `${plan.roots.find((r) => isInsideAny(t, [r])) ?? ''}|${path
        .relative(plan.roots.find((r) => isInsideAny(t, [r])) ?? '', path.dirname(it.targetPath))
        .split(path.sep)
        .join('/')}`
      // Remember the choice: next time this topic goes to the same folder (revision 1).
      if (learn && it.topic)
        repos.folderPrefs.add({ root, topic: it.topic, kind: it.category, folder: safeRel })
    }
    if (patch.suggestedName !== undefined) {
      const name = sanitizeFileName(patch.suggestedName)
      it.targetPath = path.join(path.dirname(it.targetPath), name)
      it.suggestedName = name
    }
    if (patch.category !== undefined && patch.category !== it.category) {
      const cat = categories.get(patch.category)
      if (!cat && !isContentKind(patch.category)) throw new Error('unknown_category')
      const f = files.get(it.fileId)
      if (learn && f) {
        repos.corrections.add({
          ext: f.ext,
          namePattern: namePattern(f.name),
          oldCategory: it.category,
          newCategory: patch.category,
        })
      }
      it.category = patch.category
    }
    if (patch.sensitive !== undefined) {
      const f = files.get(it.fileId)
      if (f)
        repos.files.update(f.id, {
          sensitive: patch.sensitive,
          sensitiveReason: patch.sensitive ? 'kullanıcı işaretledi' : undefined,
        })
      it.flags = patch.sensitive
        ? [...new Set([...it.flags, 'sensitive' as const])]
        : it.flags.filter((x) => x !== 'sensitive')
    }
    // Recompute the action from source vs target.
    if (it.action !== 'quarantine' && it.action !== 'trash' && it.action !== 'skip') {
      const sameDir = pathKey(path.dirname(it.sourcePath)) === pathKey(path.dirname(it.targetPath))
      const sameName = path.basename(it.sourcePath) === path.basename(it.targetPath)
      it.action =
        sameDir && sameName ? 'skip' : sameDir ? 'rename' : sameName ? 'move' : 'move_rename'
    }
    if (JSON.stringify(before) !== JSON.stringify(it)) {
      it.userEdited = true
      if (
        newTarget !== undefined ||
        patch.category !== undefined ||
        patch.suggestedName !== undefined
      )
        it.source = 'user'
      repos.plans.updateItem(it)
    }
  }
  plan.summary = {
    ...summarizePlan(plan.items, files, plan.summary.quarantineLabel),
    ai: plan.summary.ai,
  }
  repos.plans.updateSummary(planId, plan.summary)
  return plan
}

/** Approve: draft → approved (immutable from now on). */
export function approvePlan(repos: Repos, planId: string): Plan {
  const plan = repos.plans.get(planId)
  if (!plan) throw new Error('plan not found')
  if (plan.status !== 'draft') throw new Error('plan_not_draft')
  repos.plans.setStatus(planId, 'approved', Date.now())
  return repos.plans.get(planId)!
}

/** Editing an approved plan = making a new draft copy (docs/01 §4.3). */
export function duplicatePlan(repos: Repos, planId: string): Plan {
  const plan = repos.plans.get(planId)
  if (!plan) throw new Error('plan not found')
  const id = randomUUID()
  const copy: Plan = {
    ...plan,
    id,
    status: 'draft',
    createdAt: Date.now(),
    approvedAt: undefined,
    items: plan.items.map((it, i) => ({
      ...it,
      id: `${id.slice(0, 8)}-${String(i + 1).padStart(5, '0')}`,
      planId: id,
    })),
  }
  repos.plans.save(copy)
  return copy
}

/**
 * Renames (or merges) a target folder of a draft plan: every item going into `fromRel` (or a
 * sub-folder of it) now goes into `toRel`. Used by the report's folder tree (revision 1).
 */
export function renameTargetFolder(
  repos: Repos,
  planId: string,
  root: string,
  fromRel: string,
  toRel: string,
  learn = true,
): Plan {
  const plan = repos.plans.get(planId)
  if (!plan) throw new Error('plan not found')
  if (plan.status !== 'draft') throw new Error('plan_not_draft')
  if (!plan.roots.some((r) => pathKey(r) === pathKey(root))) throw new Error('target_outside_roots')
  const to = sanitizeRelDir(toRel)
  if (!to) throw new Error('empty_folder_name')
  const fromAbs = path.join(root, ...fromRel.split('/').filter(Boolean))
  const toAbs = path.join(root, ...to.split('/'))
  const fromKey = pathKey(fromAbs)
  // Group by destination so each distinct folder is one update (large folders stay fast).
  const byDir = new Map<string, string[]>()
  const under = (k: string): boolean => k === fromKey || k.startsWith(fromKey + path.sep)
  for (const it of plan.items) {
    if (it.action === 'skip' || it.action === 'quarantine' || it.action === 'trash') continue
    if (!under(pathKey(path.dirname(it.targetPath)))) continue
    const restDir = path.relative(fromAbs, path.dirname(it.targetPath))
    const newDir = restDir ? path.join(toAbs, restDir) : toAbs
    byDir.set(newDir, [...(byDir.get(newDir) ?? []), it.id])
  }
  for (const [dir, ids] of byDir) updatePlanItems(repos, planId, ids, { targetDir: dir }, learn)
  return repos.plans.get(planId) ?? plan
}
