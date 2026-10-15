import type { UndoResult } from '@shared/ipc'
import type { PendingRecovery } from '@shared/types'
import { context } from '../context'
import { applyPlan, ApplyControl } from '../core/apply'
import { recoverPending } from '../core/apply/recovery'
import { platform } from '../core/platform'
import { undoRun } from '../core/undo'
import { emit } from '../ipc/registry'
import { log } from './log'

let control: ApplyControl | null = null
let busy = false
let pendingRecovery: PendingRecovery[] = []

export function isBusy(): boolean {
  return busy
}

export async function startApply(
  planId: string,
  opts: { skipItemIds?: string[]; resume?: boolean } = {},
): Promise<{ runId: string }> {
  if (busy) throw new Error('apply_running')
  const ctx = context()
  const runId = crypto.randomUUID()
  control = new ApplyControl()
  busy = true
  log.info(`apply start plan=${planId} run=${runId}${opts.resume ? ' (resume)' : ''}`)
  void applyPlan(
    {
      repos: ctx.repos,
      platform: platform(),
      settings: ctx.settings.get(),
      control,
      onProgress: (p) => emit('apply:progress', p),
    },
    planId,
    { ...opts, runId },
  )
    .then((r) =>
      log.info(`apply ${r.status} run=${runId} done=${r.stats.done} failed=${r.stats.failed}`),
    )
    .catch((e: Error) => {
      log.error(`apply failed run=${runId}: ${e.message}`)
      emit('app:error', { message: e.message })
      emit('apply:progress', {
        runId,
        kind: 'apply',
        done: 0,
        total: 0,
        status: 'failed',
        errors: [{ itemId: null, path: '', message: e.message }],
      })
    })
    .finally(() => {
      busy = false
      control = null
    })
  return { runId }
}

export function pauseApply(): void {
  control?.pause()
}
export function resumeApply(skipFailed = true): void {
  control?.resume(skipFailed)
}
export function cancelApply(): void {
  control?.cancel()
}

export async function undo(
  runId: string,
  opts: { force?: boolean; itemId?: string } = {},
): Promise<UndoResult> {
  if (busy) throw new Error('apply_running')
  busy = true
  const ctx = context()
  try {
    log.info(`undo run=${runId}${opts.itemId ? ` item=${opts.itemId}` : ''}`)
    return await undoRun(
      {
        repos: ctx.repos,
        settings: ctx.settings.get(),
        onProgress: (p) => emit('apply:progress', p),
      },
      runId,
      opts,
    )
  } finally {
    busy = false
  }
}

/** Runs once at start-up, before the window loads. */
export async function runRecovery(): Promise<void> {
  const ctx = context()
  try {
    pendingRecovery = await recoverPending(ctx.repos, ctx.settings.get())
    if (pendingRecovery.length) log.info(`recovery: ${pendingRecovery.length} interrupted run(s)`)
  } catch (e) {
    log.error(`recovery failed: ${(e as Error).message}`)
  }
}

export function getPendingRecovery(): PendingRecovery[] {
  return pendingRecovery
}

export async function resolveRecovery(
  runId: string,
  action: 'complete' | 'undo' | 'ignore',
): Promise<void> {
  const rec = pendingRecovery.find((r) => r.runId === runId)
  pendingRecovery = pendingRecovery.filter((r) => r.runId !== runId)
  if (!rec || action === 'ignore') return
  const run = context().repos.runs.get(runId)
  if (action === 'undo') await undo(runId)
  else if (run?.kind === 'undo' && run.undoOf) await undo(run.undoOf)
  else await startApply(rec.planId, { resume: true })
}
