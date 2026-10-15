import { context } from '../context'
import { preflight } from '../core/apply'
import { platform } from '../core/platform'
import {
  approvePlan,
  duplicatePlan,
  renameTargetFolder,
  updatePlanItems,
} from '../core/planner/session'
import {
  cancelApply,
  getPendingRecovery,
  pauseApply,
  resolveRecovery,
  resumeApply,
  startApply,
  undo,
} from '../services/apply'
import {
  estimateForSession,
  listAnthropicModels,
  listLmStudioModels,
  testProvider,
} from '../services/ai'
import { buildPlanForSession, cancelPlanBuild, exportPlan } from '../services/plan'
import { listQuarantine, trashQuarantine } from '../services/quarantine'
import type { Plan } from '@shared/types'
import { handle } from './registry'

/** Adds display-only fields (size, thumbnail, sensitive) from the inventory. */
function enrich(plan: Plan): Plan {
  const repos = context().repos
  const files = new Map(repos.files.bySession(plan.sessionId).map((f) => [f.id, f]))
  const metas = repos.files.metaBySession(plan.sessionId)
  for (const it of plan.items) {
    const f = files.get(it.fileId)
    it.size = f?.size
    it.sensitive = f?.sensitive || it.flags.includes('sensitive')
    it.thumbPath = it.sensitive ? undefined : metas.get(it.fileId)?.thumbPath
  }
  return plan
}

export function registerPlanIpc(): void {
  handle('plan:get', (planId) => {
    const repos = context().repos
    const id = planId ?? repos.plans.latestId()
    const plan = id ? repos.plans.get(id) : undefined
    return plan ? enrich(plan) : null
  })
  handle('file:details', (fileId) => {
    const repos = context().repos
    const file = repos.files.get(fileId)
    return file ? { file, meta: repos.files.getMeta(fileId) } : null
  })
  handle('plan:build', async ({ sessionId, useAI }) =>
    enrich(await buildPlanForSession(sessionId, useAI)),
  )
  handle('plan:cancel', (mode) => cancelPlanBuild(mode))
  handle('plan:update', (planId, itemIds, patch) => {
    const c = context()
    return enrich(
      updatePlanItems(c.repos, planId, itemIds, patch, c.settings.get().ai.learnFromCorrections),
    )
  })
  handle('plan:renameFolder', (planId, root, fromRel, toRel) =>
    enrich(
      renameTargetFolder(
        context().repos,
        planId,
        root,
        fromRel,
        toRel,
        context().settings.get().ai.learnFromCorrections,
      ),
    ),
  )
  handle('plan:approve', (planId) => enrich(approvePlan(context().repos, planId)))
  handle('plan:duplicate', (planId) => enrich(duplicatePlan(context().repos, planId)))
  handle('plan:export', (planId, format) => exportPlan(planId, format))
  handle('plan:preflight', async (planId) => {
    const c = context()
    const plan = c.repos.plans.get(planId)
    if (!plan) throw new Error('plan not found')
    return preflight(plan, c.repos, platform(), c.settings.get())
  })

  handle('ai:estimate', (sessionId) => estimateForSession(sessionId))
  handle('ai:test', () => testProvider())
  handle('ai:models', () => listLmStudioModels())
  handle('ai:anthropicModels', () => listAnthropicModels())

  handle('apply:start', (planId, opts) => startApply(planId, opts))
  handle('apply:pause', () => pauseApply())
  handle('apply:resume', (opts) => resumeApply(opts?.skipFailed ?? true))
  handle('apply:cancel', () => cancelApply())

  handle('history:list', () => context().repos.runs.list())
  handle('history:journal', (runId) => context().repos.journal.byRun(runId))
  handle('undo:run', (runId, opts) => undo(runId, opts))
  handle('undo:item', (runId, itemId, opts) => undo(runId, { ...opts, itemId }))

  handle('recovery:pending', () => getPendingRecovery())
  handle('recovery:resolve', (runId, action) => resolveRecovery(runId, action))

  handle('quarantine:list', () => listQuarantine())
  handle('quarantine:trash', (p) => trashQuarantine(p))
}
