import type { EventChannel, InvokeArgs, InvokeChannel, InvokeResult, IpcEventMap } from './ipc'

/** Shape of `window.dondu`, exposed by the preload script. */
export interface DonduApi {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>>
  on<C extends EventChannel>(channel: C, fn: (payload: IpcEventMap[C]) => void): () => void
  ping(): Promise<InvokeResult<'app:ping'>>
  platform: string
}
