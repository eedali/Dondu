import type { JournalOp } from '@shared/types'
import type { Repos } from '../../db/repos'

/** Test hook: throw from here to simulate a crash at a precise point. */
export type FaultInjector = (op: JournalOp, seq: number, when: 'before' | 'after') => void

/**
 * Write-ahead journal helper: every physical operation is inserted as `pending` (committed)
 * before it runs, then marked `done` / `failed`.
 */
export class JournalWriter {
  private seq: number

  constructor(
    private repos: Repos,
    private runId: string,
    private planId: string,
    private fault?: FaultInjector,
  ) {
    this.seq = repos.journal.maxSeq(runId)
  }

  async op<T>(
    row: {
      itemId: string | null
      op: JournalOp
      src: string
      dst: string
      size?: number | null
      mtime?: number | null
      hash?: string | null
    },
    fn: () => Promise<T>,
    extra?: (r: T) => { size?: number; mtime?: number; hash?: string; dst?: string } | undefined,
  ): Promise<T> {
    const seq = ++this.seq
    const id = this.repos.journal.begin({ runId: this.runId, planId: this.planId, seq, ...row })
    try {
      this.fault?.(row.op, seq, 'before')
      const r = await fn()
      this.fault?.(row.op, seq, 'after')
      this.repos.journal.finish(id, 'done', undefined, extra?.(r))
      return r
    } catch (e) {
      if ((e as { simulatedCrash?: boolean }).simulatedCrash) throw e // leave row pending
      this.repos.journal.finish(id, 'failed', (e as Error).message.slice(0, 500))
      throw e
    }
  }

  skip(
    row: { itemId: string | null; op: JournalOp; src: string; dst: string },
    reason: string,
  ): void {
    const seq = ++this.seq
    const id = this.repos.journal.begin({ runId: this.runId, planId: this.planId, seq, ...row })
    this.repos.journal.finish(id, 'skipped', reason)
  }
}

/** Error thrown by a FaultInjector to simulate a process crash (the row stays pending). */
export function simulatedCrash(message = 'simulated crash'): Error {
  return Object.assign(new Error(message), { simulatedCrash: true })
}
