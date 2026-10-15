import type { ScanSummary } from '@shared/types'
import { context } from '../context'
import { emit } from '../ipc/registry'
import { runScan, summarize } from '../core/scanner/session'
import { classifySession } from '../core/rules'
import { log } from './log'

let active: { controller: AbortController; sessionId?: string } | null = null
let lastSummary: ScanSummary | null = null

export function isScanning(): boolean {
  return active !== null
}

export async function startScan(roots: string[]): Promise<{ sessionId: string }> {
  if (active) throw new Error('scan_running')
  const ctx = context()
  const settings = ctx.settings.get()
  const controller = new AbortController()
  active = { controller }
  const sessionId = crypto.randomUUID()
  active.sessionId = sessionId
  log.info(`scan start ${sessionId} roots=${roots.length}`)

  void runScan(
    {
      repos: ctx.repos,
      runner: ctx.runner,
      thumbnailer: ctx.thumbnailer,
      thumbsDir: ctx.paths.thumbs,
      postProcess: (id) => classifySession(ctx.repos, id, ctx.settings.get()),
    },
    {
      roots,
      settings,
      signal: controller.signal,
      sessionId,
      onProgress: (p) => emit('scan:progress', p),
    },
  )
    .then((s) => {
      lastSummary = s
      log.info(`scan ${s.status} ${sessionId} files=${s.totalFiles}`)
      // Keep only the latest few sessions' inventories.
      ctx.repos.sessions.prune([sessionId])
    })
    .catch((e: Error) => {
      log.error(`scan failed ${sessionId}: ${e.message}`)
      emit('scan:progress', {
        sessionId,
        phase: 'error',
        found: 0,
        analyzed: 0,
        total: 0,
        message: e.message,
      })
    })
    .finally(() => {
      active = null
    })

  return { sessionId }
}

export function cancelScan(): void {
  active?.controller.abort()
}

export function scanSummary(sessionId?: string): ScanSummary | null {
  const ctx = context()
  if (!sessionId && lastSummary) return lastSummary
  const s = sessionId ? ctx.repos.sessions.get(sessionId) : ctx.repos.sessions.latest()
  if (!s) return null
  return summarize(ctx.repos, s.id, s.roots, s.startedAt, s.status as ScanSummary['status'])
}
