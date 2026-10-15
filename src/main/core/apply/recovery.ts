import fs from 'node:fs/promises'
import path from 'node:path'
import type { Settings } from '@shared/settings'
import type { PendingRecovery } from '@shared/types'
import type { Repos } from '../../db/repos'
import { fullHash, treeHash } from '../hash'
import { sanitizeSegment, uniquePath } from '../naming'
import { isInside } from '../platform/paths'
import { exists, lp } from './fsops'

/**
 * Start-up consistency check (docs/05 §4). Resolves `pending` journal rows left by a crash
 * from what is actually on disk, marks interrupted runs as partial and reports them.
 */
export async function recoverPending(repos: Repos, settings: Settings): Promise<PendingRecovery[]> {
  const pending = repos.journal.pending()
  const touched = new Map<string, PendingRecovery>()

  for (const row of pending) {
    const rec = touched.get(row.runId) ?? {
      runId: row.runId,
      planId: row.planId,
      pendingRows: 0,
      startedAt: row.startedAt,
    }
    rec.pendingRows++
    touched.set(row.runId, rec)

    const srcEx = row.src ? await exists(row.src) : false
    const dstEx = row.dst ? await exists(row.dst) : false
    switch (row.op) {
      case 'rename':
      case 'remove_source':
        if (dstEx && !srcEx) repos.journal.finish(row.id, 'done', 'recovered')
        else if (srcEx && dstEx)
          repos.journal.finish(row.id, 'failed', 'both source and target exist')
        else repos.journal.finish(row.id, 'failed', 'interrupted before the move')
        break
      case 'mkdir':
        repos.journal.finish(row.id, dstEx ? 'done' : 'failed', 'recovered')
        break
      case 'rmdir_empty':
        repos.journal.finish(row.id, srcEx ? 'failed' : 'done', 'recovered')
        break
      case 'trash':
        repos.journal.finish(row.id, srcEx ? 'failed' : 'done', 'recovered')
        break
      case 'verify':
        repos.journal.finish(row.id, 'failed', 'interrupted during verification')
        break
      case 'copy': {
        if (!dstEx) {
          repos.journal.finish(row.id, 'failed', 'interrupted before the copy')
          break
        }
        let complete: boolean
        try {
          const st = await fs.stat(lp(row.src))
          const [a, b] = st.isDirectory()
            ? await Promise.all([treeHash(row.src), treeHash(row.dst)])
            : await Promise.all([fullHash(row.src), fullHash(row.dst)])
          complete = a === b
        } catch {
          complete = false
        }
        if (complete) {
          repos.journal.finish(row.id, 'done', 'recovered')
        } else {
          // Incomplete copy: move it aside (never delete) and mark failed.
          const plan = repos.plans.get(row.planId)
          const root = plan?.roots.find((r) => isInside(row.dst, r)) ?? path.dirname(row.dst)
          const q = uniquePath(
            path.join(
              root,
              sanitizeSegment(settings.quarantineFolderName),
              'yarim-kopyalar',
              path.basename(row.dst),
            ),
          )
          await fs.mkdir(lp(path.dirname(q)), { recursive: true })
          await fs.rename(lp(row.dst), lp(q))
          repos.journal.finish(row.id, 'failed', `incomplete copy moved to ${q}`)
        }
        break
      }
    }
  }

  // Runs left "running"/"paused" (crash between operations) are interrupted too.
  for (const r of repos.runs.list(1000)) {
    if (r.status !== 'running' && r.status !== 'paused') continue
    const rec = touched.get(r.id) ?? {
      runId: r.id,
      planId: r.planId,
      pendingRows: 0,
      startedAt: r.startedAt,
    }
    touched.set(r.id, rec)
  }
  for (const rec of touched.values()) {
    const run = repos.runs.get(rec.runId)
    if (!run) continue
    repos.runs.update(run.id, 'partial', run.stats, true)
    if (run.kind === 'apply') repos.plans.setStatus(run.planId, 'partial')
  }
  return [...touched.values()]
}
