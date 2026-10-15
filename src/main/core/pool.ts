import os from 'node:os'
import type { Worker, WorkerOptions } from 'node:worker_threads'
import { analyzeContent, type ContentResult, type ContentTask } from './extract'
import { fullHash } from './hash'

/** Work that can run off the main thread. */
export type PoolTask = { type: 'content'; task: ContentTask } | { type: 'fullHash'; path: string }

export type PoolResult<T extends PoolTask> = T extends { type: 'content' } ? ContentResult : string

export interface TaskRunner {
  run<T extends PoolTask>(task: T): Promise<PoolResult<T>>
  readonly size: number
  close(): Promise<void>
}

export async function executeTask(task: PoolTask): Promise<ContentResult | string> {
  if (task.type === 'content') return analyzeContent(task.task)
  return fullHash(task.path)
}

export function defaultPoolSize(setting = 0): number {
  return setting > 0 ? setting : Math.max(2, os.cpus().length - 1)
}

/** Runs tasks in-process with bounded concurrency (tests, or when workers are unavailable). */
export function inlineRunner(size = 4): TaskRunner {
  let active = 0
  const queue: (() => void)[] = []
  const acquire = (): Promise<void> =>
    active < size
      ? (active++, Promise.resolve())
      : new Promise<void>((r) => queue.push(() => (active++, r())))
  const release = (): void => {
    active--
    queue.shift()?.()
  }
  return {
    size,
    async run<T extends PoolTask>(task: T) {
      await acquire()
      try {
        return (await executeTask(task)) as PoolResult<T>
      } finally {
        release()
      }
    },
    async close() {},
  }
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

/** worker_threads pool. `factory` comes from electron-vite's `?nodeWorker` import. */
export function workerRunner(factory: (opts: WorkerOptions) => Worker, size: number): TaskRunner {
  const workers: { w: Worker; busy: number }[] = []
  const pending = new Map<number, Pending>()
  let seq = 0

  const spawn = (): { w: Worker; busy: number } => {
    const entry = { w: factory({}), busy: 0 }
    entry.w.on('message', (m: { id: number; ok: boolean; value?: unknown; error?: string }) => {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      entry.busy--
      if (m.ok) p.resolve(m.value)
      else p.reject(new Error(m.error ?? 'worker error'))
    })
    entry.w.on('error', (e) => {
      // Fail everything in flight on this worker; replace it.
      for (const [id, p] of pending) {
        p.reject(e)
        pending.delete(id)
      }
      const i = workers.indexOf(entry)
      if (i >= 0) workers.splice(i, 1, spawn())
    })
    entry.w.unref()
    return entry
  }
  for (let i = 0; i < size; i++) workers.push(spawn())

  return {
    size,
    run<T extends PoolTask>(task: T): Promise<PoolResult<T>> {
      const target = workers.reduce((a, b) => (b.busy < a.busy ? b : a))
      const id = ++seq
      target.busy++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        target.w.postMessage({ id, task })
      })
    },
    async close() {
      await Promise.all(workers.map((w) => w.w.terminate()))
    },
  }
}
