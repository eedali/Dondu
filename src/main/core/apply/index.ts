import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Settings } from '@shared/settings'
import type {
  ApplyProgress,
  FileRecord,
  Plan,
  PlanItem,
  PreflightIssue,
  PreflightResult,
  RunStats,
  RunStatus,
} from '@shared/types'
import type { Repos } from '../../db/repos'
import { fullHash, treeHash } from '../hash'
import { uniquePath } from '../naming'
import type { PlatformAdapter } from '../platform'
import { isInside, joinRel, pathKey } from '../platform/paths'
import { sanitizeSegment } from '../naming'
import {
  assertInsideRoots,
  codeError,
  existingAncestor,
  exists,
  fingerprint,
  isEmptyDir,
  lp,
  sameVolume,
} from './fsops'
import { JournalWriter, type FaultInjector } from './journal'

export interface ApplyDeps {
  repos: Repos
  platform: PlatformAdapter
  settings: Settings
  onProgress?: (p: ApplyProgress) => void
  fault?: FaultInjector
  control?: ApplyControl
}

/** Pause / resume / cancel from the UI while a run is in progress. */
export class ApplyControl {
  private paused = false
  private cancelled = false
  private waiters: (() => void)[] = []
  skipFailed = true

  pause(): void {
    this.paused = true
  }
  resume(skipFailed = true): void {
    this.skipFailed = skipFailed
    this.paused = false
    this.waiters.splice(0).forEach((w) => w())
  }
  cancel(): void {
    this.cancelled = true
    this.paused = false
    this.waiters.splice(0).forEach((w) => w())
  }
  get isCancelled(): boolean {
    return this.cancelled
  }
  get isPaused(): boolean {
    return this.paused
  }
  async waitIfPaused(): Promise<void> {
    while (this.paused && !this.cancelled) await new Promise<void>((r) => this.waiters.push(r))
  }
}

const ACTIVE = (it: PlanItem): boolean =>
  it.enabled && it.action !== 'skip' && it.action !== 'mkdir'

// ---------------------------------------------------------------- pre-flight

export async function preflight(
  plan: Plan,
  repos: Repos,
  platform: PlatformAdapter,
  _settings: Settings,
): Promise<PreflightResult> {
  const issues: PreflightIssue[] = []
  const items = plan.items.filter(ACTIVE)
  const files = new Map(repos.files.bySession(plan.sessionId).map((f) => [f.id, f]))

  // One write probe per root.
  const unwritable = new Set<string>()
  for (const root of plan.roots) {
    const c = await platform.checkAccess(root)
    if (!c.write) unwritable.add(pathKey(root))
  }

  const crossBytes = new Map<string, { dir: string; bytes: number }>()
  for (const it of items) {
    const f = files.get(it.fileId)
    const issue = (kind: PreflightIssue['kind'], message?: string): void => {
      issues.push({ itemId: it.id, path: it.sourcePath, kind, message })
    }
    if (!f) {
      issue('missing')
      continue
    }
    if (f.isCloudPlaceholder || platform.cloudPlaceholderRealName(path.basename(it.sourcePath))) {
      issue('cloud')
      continue
    }
    try {
      await assertInsideRoots(it.sourcePath, plan.roots)
      if (it.action !== 'trash') await assertInsideRoots(it.targetPath, plan.roots)
    } catch {
      issue('outside_root')
      continue
    }
    let fp
    try {
      fp = await fingerprint(it.sourcePath)
    } catch {
      issue('missing')
      continue
    }
    if (!fp.dir && (fp.size !== f.size || Math.abs(fp.mtime - f.mtime) > 2)) {
      issue('changed')
      continue
    }
    const root = plan.roots.find((r) => isInside(it.sourcePath, r))
    if (root && unwritable.has(pathKey(root))) {
      issue('not_writable')
      continue
    }
    if (!fp.dir) {
      // Locked / in use: try opening for read+write without changing anything.
      try {
        const fh = await fs.open(lp(it.sourcePath), 'r+')
        await fh.close()
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
          issue('locked', code)
          continue
        }
      }
    }
    if (it.action !== 'trash' && !(await sameVolume(it.sourcePath, path.dirname(it.targetPath)))) {
      const anc = await existingAncestor(path.dirname(it.targetPath))
      const e = crossBytes.get(anc) ?? { dir: anc, bytes: 0 }
      e.bytes += f.size
      crossBytes.set(anc, e)
    }
  }
  for (const { dir, bytes } of crossBytes.values()) {
    try {
      const st = await fs.statfs(lp(dir))
      if (st.bavail * st.bsize < bytes * 1.1)
        issues.push({ itemId: '', path: dir, kind: 'no_space', message: String(bytes) })
    } catch {
      /* statfs unsupported: copy will fail safely if space runs out */
    }
  }
  const blocked = new Set(issues.map((i) => i.itemId))
  return {
    ok: issues.length === 0,
    issues,
    runnable: items.filter((it) => !blocked.has(it.id)).length,
  }
}

// ---------------------------------------------------------------- run

export interface ApplyOptions {
  /** Item ids to skip (e.g. changed files the user chose not to apply). */
  skipItemIds?: string[]
  /** Continue a partial/interrupted run of the same plan (only items not yet done). */
  resume?: boolean
  runId?: string
}

export async function applyPlan(
  deps: ApplyDeps,
  planId: string,
  opts: ApplyOptions = {},
): Promise<{ runId: string; status: RunStatus; stats: RunStats }> {
  const { repos, platform, settings } = deps
  const plan = repos.plans.get(planId)
  if (!plan) throw codeError('NO_PLAN', 'plan not found')
  const allowed = opts.resume ? ['approved', 'applying', 'partial'] : ['approved']
  if (!allowed.includes(plan.status))
    throw codeError(
      'NOT_APPROVED',
      `plan status is ${plan.status}; only approved plans can be applied`,
    )

  const control = deps.control ?? new ApplyControl()
  const runId = opts.runId ?? randomUUID()
  const files = new Map(repos.files.bySession(plan.sessionId).map((f) => [f.id, f]))
  const journal = new JournalWriter(repos, runId, planId, deps.fault)

  // Items already completed by an earlier run of this plan are not repeated.
  const doneItems = new Set<string>()
  if (opts.resume) {
    for (const r of repos.runs.list(1000).filter((r) => r.planId === planId && r.kind === 'apply'))
      for (const row of repos.journal.byRun(r.id))
        if (
          row.itemId &&
          row.status === 'done' &&
          (row.op === 'rename' || row.op === 'remove_source' || row.op === 'trash')
        )
          doneItems.add(row.itemId)
  }

  const pre = await preflight(plan, repos, platform, settings)
  const blocked = new Map(pre.issues.map((i) => [i.itemId, i]))
  const skip = new Set(opts.skipItemIds ?? [])
  const items = plan.items.filter(ACTIVE).filter((it) => !doneItems.has(it.id))

  const stats: RunStats = {
    total: items.length,
    done: 0,
    skipped: 0,
    failed: 0,
    bytes: 0,
    errors: [],
    trashed: [],
  }
  repos.runs.create({
    id: runId,
    planId,
    kind: 'apply',
    startedAt: Date.now(),
    status: 'running',
    stats,
    roots: plan.roots,
  })
  repos.plans.setStatus(planId, 'applying')

  let status: RunStatus = 'running'
  const progress = (current?: string, waiting = false): void =>
    deps.onProgress?.({
      runId,
      kind: 'apply',
      done: stats.done + stats.skipped + stats.failed,
      total: stats.total,
      currentItem: current,
      status,
      errors: stats.errors ?? [],
      waiting,
    })

  const createdDirs: string[] = []
  const ensureDir = async (dir: string, itemId: string | null): Promise<void> => {
    const missing: string[] = []
    let cur = path.resolve(dir)
    while (!(await exists(cur))) {
      missing.unshift(cur)
      const up = path.dirname(cur)
      if (up === cur) break
      cur = up
    }
    for (const d of missing) {
      await assertInsideRoots(d, plan.roots)
      await journal.op({ itemId, op: 'mkdir', src: '', dst: d }, () => fs.mkdir(lp(d)))
      createdDirs.push(d)
    }
  }

  const qLabel = plan.summary.quarantineLabel ?? 'karantina'
  const quarantinePathFor = (src: string): string => {
    const root = plan.roots.find((r) => isInside(src, r)) ?? path.dirname(src)
    const rel = path.relative(root, src)
    return path.join(root, sanitizeSegment(settings.quarantineFolderName), qLabel, rel)
  }

  /** Same-volume rename; case-only renames go through a temporary name (APFS/NTFS). */
  const renameOp = async (
    itemId: string,
    src: string,
    dst: string,
    size: number,
    mtime: number,
  ): Promise<void> => {
    if (pathKey(src) === pathKey(dst) && src !== dst) {
      const tmp = `${src}.tmp-dondu-${runId.slice(0, 6)}`
      await journal.op({ itemId, op: 'rename', src, dst: tmp, size, mtime }, () =>
        fs.rename(lp(src), lp(tmp)),
      )
      await journal.op({ itemId, op: 'rename', src: tmp, dst, size, mtime }, () =>
        fs.rename(lp(tmp), lp(dst)),
      )
      return
    }
    await journal.op({ itemId, op: 'rename', src, dst, size, mtime }, () =>
      fs.rename(lp(src), lp(dst)),
    )
  }

  /** Removes the source of a verified cross-volume copy: quarantine (rename) or OS trash. */
  const removeSource = async (
    itemId: string,
    src: string,
    size: number,
    mtime: number,
  ): Promise<void> => {
    if (settings.useOsTrashInsteadOfQuarantine) {
      await journal.op({ itemId, op: 'trash', src, dst: '', size, mtime }, () =>
        platform.trash(src),
      )
      stats.trashed?.push(src)
      return
    }
    const q = uniquePath(quarantinePathFor(src))
    await ensureDir(path.dirname(q), itemId)
    await journal.op({ itemId, op: 'remove_source', src, dst: q, size, mtime }, () =>
      fs.rename(lp(src), lp(q)),
    )
  }

  const crossVolumeMove = async (
    it: PlanItem,
    f: FileRecord,
    src: string,
    dst: string,
    size: number,
    mtime: number,
  ): Promise<void> => {
    const isDir = f.kind === 'bundle'
    await journal.op({ itemId: it.id, op: 'copy', src, dst, size, mtime }, () =>
      platform.copyWithMetadata(src, dst),
    )
    let srcHash = ''
    try {
      await journal.op(
        { itemId: it.id, op: 'verify', src, dst, size, mtime },
        async () => {
          const [a, b] = await Promise.all(
            isDir ? [treeHash(src), treeHash(dst)] : [fullHash(src), fullHash(dst)],
          )
          if (a !== b) throw codeError('VERIFY_FAILED', 'copy verification failed')
          srcHash = a
          return a
        },
        (h) => ({ hash: h }),
      )
    } catch (e) {
      // Bad copy: move it aside (never delete), keep the source untouched.
      const q = uniquePath(quarantinePathFor(dst))
      await ensureDir(path.dirname(q), it.id)
      await journal.op({ itemId: it.id, op: 'rename', src: dst, dst: q }, () =>
        fs.rename(lp(dst), lp(q)),
      )
      throw e
    }
    void srcHash
    await removeSource(it.id, src, size, mtime)
  }

  for (const it of items) {
    if (control.isCancelled) break
    await control.waitIfPaused()
    if (control.isCancelled) break
    progress(it.sourcePath)
    const f = files.get(it.fileId)
    if (skip.has(it.id) || blocked.has(it.id) || !f) {
      stats.skipped++
      const why = skip.has(it.id) ? 'user' : (blocked.get(it.id)?.kind ?? 'missing')
      if (why === 'changed') stats.changed = [...(stats.changed ?? []), it.sourcePath]
      journal.skip(
        {
          itemId: it.id,
          op: it.action === 'trash' ? 'trash' : 'rename',
          src: it.sourcePath,
          dst: it.targetPath,
        },
        why,
      )
      continue
    }
    try {
      const src = it.sourcePath
      await assertInsideRoots(src, plan.roots)
      const fp = await fingerprint(src)
      if (!fp.dir && (fp.size !== f.size || Math.abs(fp.mtime - f.mtime) > 2))
        throw codeError('CHANGED', 'source changed since scan')

      if (it.action === 'trash') {
        await journal.op(
          { itemId: it.id, op: 'trash', src, dst: '', size: fp.size, mtime: fp.mtime },
          () => platform.trash(src),
        )
        stats.trashed?.push(src)
      } else {
        await assertInsideRoots(it.targetPath, plan.roots)
        await ensureDir(path.dirname(it.targetPath), it.id)
        const caseOnly = pathKey(src) === pathKey(it.targetPath)
        const dst = caseOnly ? it.targetPath : uniquePath(it.targetPath)
        if (await sameVolume(src, path.dirname(dst)))
          await renameOp(it.id, src, dst, fp.size, fp.mtime)
        else await crossVolumeMove(it, f, src, dst, fp.size, fp.mtime)
      }
      stats.done++
      stats.bytes += f.size
    } catch (e) {
      if ((e as { simulatedCrash?: boolean }).simulatedCrash) throw e
      stats.failed++
      stats.errors?.push({ itemId: it.id, path: it.sourcePath, message: (e as Error).message })
      if (settings.apply.pauseOnFirstError) {
        control.pause()
        status = 'paused'
        repos.runs.update(runId, status, stats)
        progress(it.sourcePath, true)
        await control.waitIfPaused()
        if (!control.isCancelled) status = 'running'
      }
    }
    repos.runs.update(runId, status, stats)
  }

  // Remove folders Döndü created in this run that ended up empty (deepest first).
  if (settings.removeEmptyFoldersCreatedByDondu) {
    for (const d of [...createdDirs].reverse()) {
      if (await isEmptyDir(d)) {
        await journal
          .op({ itemId: null, op: 'rmdir_empty', src: d, dst: '' }, () => fs.rmdir(lp(d)))
          .catch(() => undefined)
      }
    }
  }

  // Optional: user's source folders that became empty go to quarantine (never deleted).
  if (settings.quarantineEmptySourceFolders && !control.isCancelled) {
    const dirs = [...new Set(items.map((it) => path.dirname(it.sourcePath)))].sort(
      (a, b) => b.length - a.length,
    )
    for (const d of dirs) {
      if (plan.roots.some((r) => pathKey(r) === pathKey(d))) continue
      if (await isEmptyDir(d)) {
        const q = uniquePath(quarantinePathFor(d))
        await ensureDir(path.dirname(q), null)
        await journal
          .op({ itemId: null, op: 'rename', src: d, dst: q }, () => fs.rename(lp(d), lp(q)))
          .catch(() => undefined)
      }
    }
  }

  status = control.isCancelled ? 'cancelled' : stats.failed || stats.skipped ? 'partial' : 'done'
  repos.runs.update(runId, status, stats, true)
  repos.plans.setStatus(planId, status === 'done' ? 'applied' : 'partial')
  progress()
  return { runId, status, stats }
}

export { joinRel }
