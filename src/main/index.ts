import fs from 'node:fs'
import os from 'node:os'
import path, { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, nativeTheme, net, protocol, safeStorage, shell } from 'electron'
import createAnalyzeWorker from './core/analyze.worker?nodeWorker'
import { appPaths, setContext } from './context'
import { forbidFolders, setShell } from './core/platform'
import { isInside } from './core/platform/paths'
import { defaultPoolSize, inlineRunner, workerRunner } from './core/pool'
import { openBetterSqlite } from './db/better-sqlite3'
import { createRepos } from './db/repos'
import { registerIpc } from './ipc'
import { setMainWindow } from './ipc/registry'
import { runRecovery } from './services/apply'
import { initLog, log } from './services/log'
import { electronThumbnailer } from './services/thumbnailer'
import { SettingsStore } from './settings'
import { SecretStore } from './settings/secrets'

const isDev = !app.isPackaged

// Stable, ASCII user data folder: ~/Library/Application Support/Dondu, %AppData%\Dondu.
app.setName('Dondu')
if (process.env['DONDU_USERDATA']) app.setPath('userData', process.env['DONDU_USERDATA'])

protocol.registerSchemesAsPrivileged([
  { scheme: 'dondu-thumb', privileges: { standard: false, secure: true, supportFetchAPI: true } },
])

function createWindow(): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'Döndü',
    backgroundColor: dark ? '#12141F' : '#F6F7FA',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => {
    if (!process.env['DONDU_SCREENSHOT']) win.show()
  })

  // Dev tooling: DONDU_SCREENSHOT=<file.png> captures the window once and quits (UI verification).
  const shot = process.env['DONDU_SCREENSHOT']
  if (shot && !app.isPackaged) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(
        () => {
          void win.webContents.capturePage().then(async (img) => {
            fs.writeFileSync(shot, img.toPNG())
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
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  win.webContents.on('will-navigate', (event, url) => {
    if (!devUrl || !url.startsWith(devUrl)) event.preventDefault()
  })

  // Dev tooling: DONDU_ROUTE / DONDU_AUTOSCAN / DONDU_AUTOPLAN are passed as query params.
  const query: Record<string, string> = {}
  if (!app.isPackaged) {
    for (const k of ['ROUTE', 'AUTOSCAN', 'AUTOPLAN', 'AUTOAPPLY'])
      if (process.env[`DONDU_${k}`]) query[k.toLowerCase()] = process.env[`DONDU_${k}`]!
  }
  const qs = new URLSearchParams(query).toString()
  if (isDev && devUrl) {
    void win.loadURL(devUrl + (qs ? `?${qs}` : ''))
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
  return win
}

function initContext(): void {
  const paths = appPaths(app.getPath('userData'))
  fs.mkdirSync(paths.logs, { recursive: true })
  const lang = app.getLocale().toLowerCase().startsWith('tr') ? 'tr' : 'en'
  const settings = new SettingsStore(join(paths.userData, 'settings.json'), { language: lang })
  initLog(paths.logs, settings.get().logs.level)
  log.info(`Döndü ${app.getVersion()} starting on ${process.platform}/${process.arch}`)

  const repos = createRepos(openBetterSqlite(paths.db))
  let runner
  try {
    runner = workerRunner(createAnalyzeWorker, defaultPoolSize(settings.get().scan.hashWorkers))
  } catch (e) {
    log.error(`worker pool unavailable, falling back to inline: ${(e as Error).message}`)
    runner = inlineRunner(Math.max(2, os.cpus().length - 1))
  }

  setShell(shell)
  forbidFolders([paths.userData])
  setContext({
    repos,
    settings,
    secrets: new SecretStore(join(paths.userData, 'secrets.json'), safeStorage),
    runner,
    thumbnailer: electronThumbnailer,
    paths,
    dbBackend: 'better-sqlite3',
    isDev,
  })

  // Dev tooling only: preset roots / auto-scan for unattended UI checks.
  if (!app.isPackaged && process.env['DONDU_DEV_ROOTS']) {
    settings.set({ roots: process.env['DONDU_DEV_ROOTS'].split(path.delimiter).filter(Boolean) })
  }

  // Thumbnails are served only from the app's own cache directory.
  protocol.handle('dondu-thumb', (req) => {
    const file = decodeURIComponent(req.url.replace(/^dondu-thumb:\/\/?/, ''))
    if (!isInside(file, paths.thumbs)) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.dondu.app')
    initContext()
    await runRecovery()
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
