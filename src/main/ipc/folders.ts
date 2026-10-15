import { BrowserWindow, dialog } from 'electron'
import { context } from '../context'
import { platform } from '../core/platform'
import { validateRoots } from '../core/platform/roots'
import { cancelScan, scanSummary, startScan } from '../services/scan'
import { handle } from './registry'

export function registerFolderIpc(): void {
  handle('folders:pick', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'multiSelections', 'createDirectory'],
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths.length) return { accepted: [], rejected: [] }
    return validate(res.filePaths)
  })

  handle('folders:validate', (paths) => validate(paths))

  handle('platform:check', (roots) => Promise.all(roots.map((r) => platform().checkAccess(r))))
  handle('platform:openPrivacy', (pane) => platform().openPrivacySettings(pane))

  handle('scan:start', (roots) => startScan(roots))
  handle('scan:cancel', () => cancelScan())
  handle('scan:summary', (sessionId) => scanSummary(sessionId))
}

async function validate(paths: string[]) {
  const c = context()
  const existing = c.settings.get().roots
  const res = await validateRoots(paths, existing, platform(), [c.paths.userData])
  if (res.accepted.length) {
    // Accepted roots that contain existing ones replace them.
    const { mergeRoots } = await import('../core/platform/paths')
    c.settings.set({ roots: mergeRoots([...existing, ...res.accepted]) })
  }
  return res
}
