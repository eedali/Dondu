/**
 * IPC contract between main and renderer. Every channel is `domain:verb`.
 * Request/response types live here so both sides stay in sync.
 */

export interface PingResult {
  pong: true
  platform: string
  version: string
}

/** Request/response channels (renderer → main, `ipcRenderer.invoke`). */
export interface IpcInvokeMap {
  'app:ping': { args: []; result: PingResult }
}

export type InvokeChannel = keyof IpcInvokeMap
export type InvokeArgs<C extends InvokeChannel> = IpcInvokeMap[C]['args']
export type InvokeResult<C extends InvokeChannel> = IpcInvokeMap[C]['result']

/** Events pushed from main to renderer (`webContents.send`). */
export interface IpcEventMap {
  'app:log': { level: 'info' | 'error'; message: string }
}

export type EventChannel = keyof IpcEventMap
