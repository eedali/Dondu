import fs from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { Plan } from '@shared/types'
import { context } from '../context'
import { exportHtml, exportJson, exportMarkdown } from '../core/planner/export'
import { planFromSession } from '../core/planner/session'
import { emit } from '../ipc/registry'
import { runAiForSession } from './ai'
import { log } from './log'

let aiController: AbortController | null = null

export async function buildPlanForSession(sessionId: string, useAI: boolean): Promise<Plan> {
  const ctx = context()
  const settings = ctx.settings.get()
  emit('plan:progress', { phase: 'rules', done: 0, total: 1 })
  let ai: Awaited<ReturnType<typeof runAiForSession>> | undefined
  if (useAI && settings.ai.provider !== 'none') {
    aiController = new AbortController()
    try {
      ai = await runAiForSession(sessionId, aiController.signal, (done, total) =>
        emit('plan:progress', { phase: 'ai', done, total }),
      )
    } catch (e) {
      // AI problems never block planning: rules still produce a plan (docs/01 §8).
      log.error(`ai step failed: ${(e as Error).message}`)
      emit('app:error', { message: 'ai_failed' })
    } finally {
      aiController = null
    }
  }
  emit('plan:progress', { phase: 'planning', done: 0, total: 1 })
  const plan = planFromSession(ctx.repos, sessionId, settings, ai?.results, ai?.summary)
  emit('plan:progress', { phase: 'done', done: 1, total: 1 })
  log.info(`plan ${plan.id} items=${plan.items.length} move=${plan.summary.move}`)
  return plan
}

export function cancelPlanBuild(): void {
  aiController?.abort()
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
