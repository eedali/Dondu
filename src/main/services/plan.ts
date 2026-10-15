import fs from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { PlanProgress } from '@shared/ipc'
import type { Plan } from '@shared/types'
import { context } from '../context'
import { exportHtml, exportJson, exportMarkdown } from '../core/planner/export'
import { planFromSession } from '../core/planner/session'
import { emit } from '../ipc/registry'
import { runAiForSession } from './ai'
import { log } from './log'

/** The plan build in progress (one at a time). */
interface PlanJob {
  controller: AbortController
  mode: 'run' | 'partial' | 'abort'
  startedAt: number
  usd: number
  last?: Omit<PlanProgress, 'startedAt' | 'usd' | 'stopping'>
}
let job: PlanJob | null = null

export class PlanCancelled extends Error {
  constructor() {
    super('plan_cancelled')
  }
}

export async function buildPlanForSession(sessionId: string, useAI: boolean): Promise<Plan> {
  if (job) throw new Error('plan_running')
  const ctx = context()
  const settings = ctx.settings.get()
  const current: PlanJob = {
    controller: new AbortController(),
    mode: 'run',
    startedAt: Date.now(),
    usd: 0,
  }
  job = current
  const progress = (p: Omit<PlanProgress, 'startedAt' | 'usd' | 'stopping'>): void => {
    current.last = p
    emit('plan:progress', {
      ...p,
      startedAt: current.startedAt,
      usd: current.usd,
      stopping: current.mode !== 'run',
    })
  }
  try {
    progress({ phase: 'rules', done: 0, total: 1 })
    let ai: Awaited<ReturnType<typeof runAiForSession>> | undefined
    if (useAI && settings.ai.provider !== 'none') {
      try {
        ai = await runAiForSession(sessionId, current.controller.signal, (done, total, usd) => {
          current.usd = usd
          progress({ phase: 'ai', done, total })
        })
      } catch (e) {
        if (current.mode === 'abort') throw new PlanCancelled()
        // AI problems never block planning: rules still produce a plan (docs/01 §8).
        if (current.mode === 'run') {
          log.error(`ai step failed: ${(e as Error).message}`)
          emit('app:error', { message: 'ai_failed' })
        }
      }
    }
    if (current.mode === 'abort') throw new PlanCancelled()
    progress({ phase: 'planning', done: 0, total: 1 })
    const plan = planFromSession(ctx.repos, sessionId, settings, ai?.results, ai?.summary)
    progress({ phase: 'done', done: 1, total: 1 })
    log.info(
      `plan ${plan.id} items=${plan.items.length} move=${plan.summary.move}${current.mode === 'partial' ? ' (stopped early)' : ''}`,
    )
    return plan
  } catch (e) {
    if (e instanceof PlanCancelled) {
      log.info('plan build cancelled by user')
      progress({ phase: 'cancelled', done: 0, total: 0 })
    }
    throw e
  } finally {
    job = null
  }
}

/**
 * Stop the running build. `partial`: keep the AI answers received so far and plan the rest with
 * rules. `abort`: no plan at all. Either way in-flight requests are cut immediately.
 */
export function cancelPlanBuild(mode: 'partial' | 'abort'): void {
  if (!job) return
  job.mode = mode
  job.controller.abort()
  emit('plan:progress', {
    ...(job.last ?? { phase: 'ai', done: 0, total: 0 }),
    startedAt: job.startedAt,
    usd: job.usd,
    stopping: true,
  })
}

export async function exportPlan(
  planId: string,
  format: 'html' | 'md' | 'json',
): Promise<{ path: string } | null> {
  const ctx = context()
  const plan = ctx.repos.plans.get(planId)
  if (!plan) throw new Error('plan not found')
  const settings = ctx.settings.get()
  const includeExcerpts = settings.report.exportIncludesExcerpts
  const opts = {
    categories: ctx.repos.categories.all(),
    metas: includeExcerpts ? ctx.repos.files.metaBySession(plan.sessionId) : undefined,
    includeExcerpts,
  }
  const content =
    format === 'json'
      ? exportJson(plan)
      : format === 'md'
        ? exportMarkdown(plan, opts)
        : exportHtml(plan, opts)
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const stamp = new Date(plan.createdAt).toISOString().slice(0, 10)
  const dOpts: Electron.SaveDialogOptions = {
    defaultPath: `Dondu-plan-${stamp}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  }
  const res = win ? await dialog.showSaveDialog(win, dOpts) : await dialog.showSaveDialog(dOpts)
  if (res.canceled || !res.filePath) return null
  // The user explicitly picked this path in the save dialog; writing it is not a plan action.
  await fs.writeFile(res.filePath, content, 'utf8')
  log.info(`plan exported ${format} → ${path.basename(res.filePath)}`)
  return { path: res.filePath }
}
