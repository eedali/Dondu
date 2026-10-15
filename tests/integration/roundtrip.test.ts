import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyPlan, ApplyControl } from '../../src/main/core/apply'
import { simulatedCrash } from '../../src/main/core/apply/journal'
import { recoverPending } from '../../src/main/core/apply/recovery'
import { createAdapter } from '../../src/main/core/platform'
import { approvePlan, planFromSession, updatePlanItems } from '../../src/main/core/planner/session'
import { undoRun } from '../../src/main/core/undo'
import type { Repos } from '../../src/main/db/repos'
import type { Settings } from '../../src/shared/settings'
import { scanFixture } from '../helpers/scan'
import { diffMaps, dirExists, hashTree } from '../helpers/tree'

const platform = createAdapter()

/** Plan with every actionable item enabled, approved. */
function approvedPlanAllEnabled(repos: Repos, sessionId: string, settings: Settings) {
  const plan = planFromSession(repos, sessionId, settings)
  const ids = plan.items.filter((i) => i.action !== 'skip').map((i) => i.id)
  updatePlanItems(repos, plan.id, ids, { enabled: true }, false)
  return approvePlan(repos, plan.id)
}

describe('apply → undo round-trip', () => {
  it('restores the tree byte-for-byte and leaves no quarantine behind', async () => {
    const { info, repos, sessionId, settings } = await scanFixture()
    const before = await hashTree(info.dir)
    const plan = approvedPlanAllEnabled(repos, sessionId, settings)
    expect(plan.items.filter((i) => i.enabled).length).toBeGreaterThan(40)

    const res = await applyPlan({ repos, platform, settings }, plan.id)
    expect(res.stats.failed).toBe(0)
    const after = await hashTree(info.dir)
    expect(diffMaps(before, after).length).toBeGreaterThan(0)

    // Something real happened: duplicates went to quarantine, invoices to their folder.
    const q = path.join(info.dir, 'Döndü Karantina')
    expect(await dirExists(q)).toBe(true)
    expect([...after.keys()].some((k) => k.startsWith('Belgeler/Fatura ve Makbuz/2024/'))).toBe(
      true,
    )
    expect([...after.keys()].some((k) => k.startsWith('Fotoğraflar/2023/07/'))).toBe(true)
    // nothing was lost: same multiset of contents
    expect([...after.values()].sort()).toEqual([...before.values()].sort())

    const undo = await undoRun({ repos, settings }, res.runId)
    expect(undo.failed).toBe(0)
    expect(undo.changed).toEqual([])
    const restored = await hashTree(info.dir)
    expect(diffMaps(before, restored)).toEqual([])
    expect(await dirExists(q)).toBe(false)
    expect(repos.plans.get(plan.id)?.status).toBe('undone')

    // Undoing the undo re-applies.
    await undoRun({ repos, settings }, undo.runId)
    expect(diffMaps(after, await hashTree(info.dir))).toEqual([])
  })

  it('refuses to apply a plan that is not approved', async () => {
    const { repos, sessionId, settings } = await scanFixture()
    const plan = planFromSession(repos, sessionId, settings)
    await expect(applyPlan({ repos, platform, settings }, plan.id)).rejects.toThrow(/approved/)
  })

  it('survives a crash mid-run: recovery + undo still round-trips', async () => {
    const { info, repos, sessionId, settings } = await scanFixture()
    const before = await hashTree(info.dir)
    const plan = approvedPlanAllEnabled(repos, sessionId, settings)
    const fault = (op: string, seq: number, when: 'before' | 'after'): void => {
      if (op === 'rename' && seq > 25 && when === 'after') throw simulatedCrash()
    }
    await expect(
      applyPlan({ repos, platform, settings, fault }, plan.id, { runId: 'crash-run' }),
    ).rejects.toThrow(/simulated crash/)
    const runId = 'crash-run'
    expect(repos.journal.pending().length).toBe(1)

    const rec = await recoverPending(repos, settings)
    expect(rec.map((r) => r.runId)).toContain(runId)
    expect(repos.journal.pending().length).toBe(0)
    expect(repos.runs.get(runId)?.status).toBe('partial')

    const undo = await undoRun({ repos, settings }, runId)
    expect(undo.failed).toBe(0)
    expect(diffMaps(before, await hashTree(info.dir))).toEqual([])
  })

  it('resumes an interrupted run without repeating finished items', async () => {
    const { info, repos, sessionId, settings } = await scanFixture()
    const plan = approvedPlanAllEnabled(repos, sessionId, settings)
    const fault = (op: string, seq: number, when: 'before' | 'after'): void => {
      if (op === 'rename' && seq === 10 && when === 'before') throw simulatedCrash()
    }
    await expect(applyPlan({ repos, platform, settings, fault }, plan.id)).rejects.toThrow()
    await recoverPending(repos, settings)
    const res = await applyPlan({ repos, platform, settings }, plan.id, { resume: true })
    expect(res.stats.failed).toBe(0)
    const after = await hashTree(info.dir)
    expect([...after.keys()].some((k) => k.startsWith('Belgeler/Fatura ve Makbuz/'))).toBe(true)
  })
})

describe('apply safety', () => {
  it('never overwrites: an existing target gets a " (2)" suffix', async () => {
    const { info, repos, sessionId, settings } = await scanFixture()
    const plan = approvedPlanAllEnabled(repos, sessionId, settings)
    const it = plan.items.find((i) => i.sourcePath.endsWith('lasku_2023_05.pdf'))!
    await fs.mkdir(path.dirname(it.targetPath), { recursive: true })
    await fs.writeFile(it.targetPath, 'someone else')
    await applyPlan({ repos, platform, settings }, plan.id)
    expect(await fs.readFile(it.targetPath, 'utf8')).toBe('someone else')
    const suffixed = it.targetPath.replace(/\.pdf$/, ' (2).pdf')
    expect((await fs.stat(suffixed)).size).toBeGreaterThan(100)
    void info
  })

  it('skips sources that changed after the scan and reports them', async () => {
    const { info, repos, sessionId, settings } = await scanFixture()
    const plan = approvedPlanAllEnabled(repos, sessionId, settings)
    const src = path.join(info.dir, 'notlar.txt')
    await fs.appendFile(src, 'yeni satır\n')
    const res = await applyPlan({ repos, platform, settings }, plan.id)
    expect(res.stats.changed).toContain(src)
    expect(await fs.readFile(src, 'utf8')).toContain('yeni satır')
  })

  it('rejects targets outside the selected roots', async () => {
    const { info, repos, sessionId, settings } = await scanFixture()
    const plan = approvedPlanAllEnabled(repos, sessionId, settings)
    const it = plan.items.find((i) => i.sourcePath.endsWith('notlar.txt'))!
    it.targetPath = path.join(path.dirname(info.dir), 'kacak', 'notlar.txt')
    repos.plans.updateItem(it) // tamper directly (bypassing plan:update validation)
    await applyPlan({ repos, platform, settings }, plan.id)
    expect(await dirExists(path.join(path.dirname(info.dir), 'kacak'))).toBe(false)
    expect(await fs.stat(path.join(info.dir, 'notlar.txt'))).toBeTruthy()
  })

  it('handles case-only renames (A.txt → a.txt)', async () => {
    const { info, repos, sessionId, settings } = await scanFixture()
    const plan = planFromSession(repos, sessionId, settings)
    const it = plan.items.find((i) => i.sourcePath.endsWith('todo.md'))!
    const upper = path.join(info.dir, 'TODO.md')
    updatePlanItems(repos, plan.id, [it.id], { targetPath: upper, enabled: true })
    // only this item
    const others = plan.items.filter((i) => i.id !== it.id).map((i) => i.id)
    updatePlanItems(repos, plan.id, others, { enabled: false })
    approvePlan(repos, plan.id)
    const res = await applyPlan({ repos, platform, settings }, plan.id)
    expect(res.stats.done).toBe(1)
    expect((await fs.readdir(info.dir)).includes('TODO.md')).toBe(true)
    expect((await fs.readdir(info.dir)).includes('todo.md')).toBe(false)
    await undoRun({ repos, settings }, res.runId)
    expect((await fs.readdir(info.dir)).includes('todo.md')).toBe(true)
  })

  it('moves NFD-named files to NFC targets and undo finds them', async () => {
    const { info, repos, sessionId, settings } = await scanFixture()
    const before = await hashTree(info.dir)
    const plan = planFromSession(repos, sessionId, settings)
    const it = plan.items.find((i) =>
      i.sourcePath.normalize('NFC').endsWith('Çiçek fotoğrafı.jpg'),
    )!
    expect(it.action).toBe('move')
    expect(path.basename(it.targetPath)).toBe('Çiçek fotoğrafı.jpg'.normalize('NFC'))
    const others = plan.items.filter((i) => i.id !== it.id).map((i) => i.id)
    updatePlanItems(repos, plan.id, others, { enabled: false })
    approvePlan(repos, plan.id)
    const res = await applyPlan({ repos, platform, settings }, plan.id)
    expect(res.stats.done).toBe(1)
    await undoRun({ repos, settings }, res.runId)
    expect(diffMaps(before, await hashTree(info.dir))).toEqual([])
  })

  it('pauses on the first error and continues when resumed', async () => {
    const { repos, sessionId, settings } = await scanFixture()
    const plan = approvedPlanAllEnabled(repos, sessionId, settings)
    const control = new ApplyControl()
    let failedOnce = false
    const fault = (op: string, _seq: number, when: 'before' | 'after'): void => {
      if (!failedOnce && op === 'rename' && when === 'before') {
        failedOnce = true
        throw new Error('disk hiccup')
      }
    }
    let sawWaiting = false
    const run = applyPlan(
      {
        repos,
        platform,
        settings,
        fault,
        control,
        onProgress: (p) => {
          if (p.waiting && !sawWaiting) {
            sawWaiting = true
            setTimeout(() => control.resume(true), 10)
          }
        },
      },
      plan.id,
    )
    const res = await run
    expect(sawWaiting).toBe(true)
    expect(res.stats.failed).toBe(1)
    expect(res.stats.done).toBeGreaterThan(10)
    expect(res.status).toBe('partial')
  })
})
