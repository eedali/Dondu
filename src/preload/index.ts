import { contextBridge, ipcRenderer } from 'electron'
import type { DonduApi } from '@shared/api'
import type {
  EventChannel,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  IpcEventMap,
} from '@shared/ipc'

const EVENTS: EventChannel[] = ['scan:progress', 'plan:progress', 'apply:progress', 'app:error']

function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<InvokeResult<C>>
}

function on<C extends EventChannel>(channel: C, fn: (payload: IpcEventMap[C]) => void): () => void {
  if (!EVENTS.includes(channel)) throw new Error(`Unknown event ${channel}`)
  const listener = (_e: Electron.IpcRendererEvent, payload: IpcEventMap[C]): void => fn(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DonduApi = {
  invoke,
  on,
  ping: () => invoke('app:ping'),
  platform: process.platform,
}

contextBridge.exposeInMainWorld('dondu', api)
