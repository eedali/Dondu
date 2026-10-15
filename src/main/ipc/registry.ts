import { ipcMain, type BrowserWindow } from 'electron'
import type {
  EventChannel,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  IpcEventMap,
} from '@shared/ipc'

/** Typed wrapper around `ipcMain.handle`. */
export function handle<C extends InvokeChannel>(
  channel: C,
  fn: (...args: InvokeArgs<C>) => Promise<InvokeResult<C>> | InvokeResult<C>,
): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, (_event, ...args) => fn(...(args as InvokeArgs<C>)))
}

let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

/** Typed push event to the renderer. */
export function emit<C extends EventChannel>(channel: C, payload: IpcEventMap[C]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}
