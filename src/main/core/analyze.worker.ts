import { parentPort } from 'node:worker_threads'
import { executeTask, type PoolTask } from './pool'

parentPort?.on('message', async (msg: { id: number; task: PoolTask }) => {
  try {
    const value = await executeTask(msg.task)
    parentPort?.postMessage({ id: msg.id, ok: true, value })
  } catch (e) {
    parentPort?.postMessage({ id: msg.id, ok: false, error: (e as Error).message })
  }
})
