import { contextBridge, ipcRenderer } from 'electron'
import type { DonduApi } from '@shared/api'
import type {
  EventChannel,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  IpcEventMap,
} from '@shared/ipc'

function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<InvokeResult<C>>
}

export function on<C extends EventChannel>(
  channel: C,
  fn: (payload: IpcEventMap[C]) => void,
): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: IpcEventMap[C]): void => fn(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DonduApi = {
  ping: () => invoke('app:ping'),
}

contextBridge.exposeInMainWorld('dondu', api)
