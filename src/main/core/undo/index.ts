import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { UndoResult } from '@shared/ipc'
import type { Settings } from '@shared/settings'
import type { ApplyProgress, JournalRow, RunStats } from '@shared/types'
import type { Repos } from '../../db/repos'
import { sanitizeSegment, uniquePath } from '../naming'
import { isInside, pathKey } from '../platform/paths'
import { exists, fingerprint, isEmptyDir, lp } from '../apply/fsops'
import { JournalWriter, type FaultInjector } from '../apply/journal'

export interface UndoDeps {
  repos: Repos
  settings: Settings
  onProgress?: (p: ApplyProgress) => void
  fault?: FaultInjector
}

export interface UndoOptions {
  /** Restore even if the file changed since it was moved (user confirmed). */
  force?: boolean
  /** Only rows of this plan item. */
  itemId?: string
}

/**
 * Replays the journal of `runId` backwards (docs/05 §5). Never overwrites: if the original
 * location is taken the file comes back as "name (geri alındı).ext". Undo is itself a run, so
 * undoing an undo re-applies.
 */
export async function undoRun(
  deps: UndoDeps,
  runId: string,
  opts: UndoOptions = {},
): Promise<UndoResult> {
  const { repos, settings } = deps
  const run = repos.runs.get(runId)
  if (!run) throw new Error('run not found')
  const plan = repos.plans.get(run.planId)
  const roots = plan?.roots ?? run.roots

  const rows = repos.journal
    .byRun(runId)
    .filter((r) => r.status === 'done' && (!opts.itemId || r.itemId === opts.itemId))
    .sort((a, b) => b.seq - a.seq || b.id - a.id)

  const undoId = randomUUID()
  const journal = new JournalWriter(repos, undoId, run.planId, deps.fault)
  const res: UndoResult = {
    runId: undoId,
    undone: 0,
    skipped: 0,
    failed: 0,
    changed: [],
    trashed: [],
  }
  const stats: RunStats = {
    total: rows.length,
    done: 0,
    skipped: 0,
    failed: 0,
    bytes: 0,
    errors: [],
  }
  repos.runs.create({
    id: undoId,
    planId: run.planId,
    kind: 'undo',
    startedAt: Date.now(),
    status: 'running',
    stats,
    roots,
    undoOf: runId,
  })

  const quarantineFor = (p: string): string => {
    const root = roots.find((r) => isInside(p, r)) ?? path.dirname(p)
    const label = `geri-alma-${new Date().toISOString().slice(0, 10)}`
    return path.join(
      root,
      sanitizeSegment(settings.quarantineFolderName),
      label,
      path.relative(root, p),
    )
  }

  const ensureParent = async (dir: string, itemId: string | null): Promise<void> => {
    const missing: string[] = []
    let cur = path.resolve(dir)
    while (!(await exists(cur))) {
      missing.unshift(cur)
      const up = path.dirname(cur)
      if (up === cur) break
      cur = up
    }
    for (const d of missing)
      await journal.op({ itemId, op: 'mkdir', src: '', dst: d }, () => fs.mkdir(lp(d)))
  }

  const changedSince = async (p: string, row: JournalRow): Promise<boolean> => {
    if (row.size === null || row.mtime === null) return false
    const fp = await fingerprint(p)
    if (fp.dir) return false
    return fp.size !== row.size || Math.abs(fp.mtime - row.mtime) > 2
  }

  /** Move `from` back to `to` (with " (geri alındı)" if `to` is taken). */
  const moveBack = async (row: JournalRow, from: string, to: string): Promise<boolean> => {
    if (!(await exists(from))) {
      res.skipped++
      stats.errors?.push({ itemId: row.itemId, path: from, message: 'missing' })
      return false
    }
    if (!opts.force && (await changedSince(from, row))) {
      res.changed.push(from)
      res.skipped++
      return false
    }
    await ensureParent(path.dirname(to), row.itemId)
    const caseTwin = pathKey(from) === pathKey(to)
    const target =
      !caseTwin && (await exists(to)) ? uniquePath(to, new Set(), undefined, 'geri alındı') : to
    await journal.op(
      {
        itemId: row.itemId,
        op: 'rename',
        src: from,
        dst: target,
        size: row.size,
        mtime: row.mtime,
      },
      () => fs.rename(lp(from), lp(target)),
    )
    return true
  }

  let n = 0
  for (const row of rows) {
    deps.onProgress?.({
      runId: undoId,
      kind: 'undo',
      done: n++,
      total: rows.length,
      currentItem: row.dst || row.src,
      status: 'running',
      errors: stats.errors ?? [],
    })
    try {
      let ok = false
      switch (row.op) {
        case 'rename':
        case 'remove_source':
          ok = await moveBack(row, row.dst, row.src)
          break
        case 'verify':
          ok = true
          break
        case 'copy': {
          // The copy at dst goes to quarantine; the source was restored by remove_source's undo.
          if (!(await exists(row.dst))) {
            ok = true
            break
          }
          if (!opts.force && (await changedSince(row.dst, row))) {
            res.changed.push(row.dst)
            res.skipped++
            break
          }
          const q = uniquePath(quarantineFor(row.dst))
          await ensureParent(path.dirname(q), row.itemId)
          await journal.op({ itemId: row.itemId, op: 'rename', src: row.dst, dst: q }, () =>
            fs.rename(lp(row.dst), lp(q)),
          )
          ok = true
          break
        }
        case 'mkdir':
          if (!(await exists(row.dst))) ok = true
          else if (await isEmptyDir(row.dst)) {
            await journal.op({ itemId: row.itemId, op: 'rmdir_empty', src: row.dst, dst: '' }, () =>
              fs.rmdir(lp(row.dst)),
            )
            ok = true
          } else {
            // Something else lives there now (e.g. another item not undone): leave it.
            res.skipped++
          }
          break
        case 'rmdir_empty':
          if (!(await exists(row.src)))
            await journal.op({ itemId: row.itemId, op: 'mkdir', src: '', dst: row.src }, () =>
              fs.mkdir(lp(row.src)),
            )
          ok = true
          break
        case 'trash':
          // OS trash cannot be restored automatically: the user restores it from Trash/Recycle Bin.
          res.trashed.push(row.src)
          res.skipped++
          break
      }
      if (ok) {
        repos.journal.markUndone(row.id)
        res.undone++
      }
    } catch (e) {
      if ((e as { simulatedCrash?: boolean }).simulatedCrash) throw e
      res.failed++
      stats.errors?.push({
        itemId: row.itemId,
        path: row.dst || row.src,
        message: (e as Error).message,
      })
    }
  }

  stats.done = res.undone
  stats.skipped = res.skipped
  stats.failed = res.failed
  stats.changed = res.changed
  stats.trashed = res.trashed
  const status = res.failed || res.skipped ? 'partial' : 'done'
  repos.runs.update(undoId, status, stats, true)

  // Plan becomes "undone" once nothing of its apply runs remains done (trash rows excepted).
  if (plan) {
    const applyRuns = repos.runs
      .list(1000)
      .filter((r) => r.planId === plan.id && r.kind === 'apply')
    const remaining = applyRuns
      .flatMap((r) => repos.journal.byRun(r.id))
      .some((r) => r.status === 'done' && r.op !== 'verify' && r.op !== 'trash')
    if (!remaining) repos.plans.setStatus(plan.id, 'undone')
  }
  deps.onProgress?.({
    runId: undoId,
    kind: 'undo',
    done: rows.length,
    total: rows.length,
    status,
    errors: stats.errors ?? [],
  })
  return res
}
