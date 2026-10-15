import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { registerIpc } from './ipc'
import { setMainWindow } from './ipc/registry'

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Döndü',
    backgroundColor: '#F7F6F3',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Dev tooling: DONDU_SCREENSHOT=<file.png> captures the window once and quits (UI verification).
  const shot = process.env['DONDU_SCREENSHOT']
  if (shot && !app.isPackaged) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(
        () => {
          void win.webContents.capturePage().then(async (img) => {
            const { writeFile } = await import('node:fs/promises')
            await writeFile(shot, img.toPNG())
            app.quit()
          })
        },
        Number(process.env['DONDU_SCREENSHOT_DELAY'] ?? 1500),
      )
    })
  }

  // Never open new windows inside the app; external links go to the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isDev || !url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? ''))
      event.preventDefault()
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setName('Dondu')
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.dondu.app')
    registerIpc()
    setMainWindow(createWindow())

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) setMainWindow(createWindow())
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
