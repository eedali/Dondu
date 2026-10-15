import fs from 'node:fs/promises'
import { app, shell } from 'electron'
import { DEFAULT_CATEGORIES } from '@shared/categories'
import { context } from '../context'
import { platform } from '../core/platform'
import { log, setLogLevel } from '../services/log'
import { handle } from './registry'

export function registerAppIpc(): void {
  handle('app:ping', async () => ({
    pong: true as const,
    platform: process.platform,
    version: app.getVersion(),
  }))

  handle('app:info', () => {
    const c = context()
    return {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      userData: c.paths.userData,
      logsDir: c.paths.logs,
      dbBackend: c.dbBackend,
      isDev: c.isDev,
    }
  })

  handle('settings:get', () => context().settings.get())
  handle('settings:set', (patch) => {
    const s = context().settings.set(patch)
    setLogLevel(s.logs.level)
    return s
  })
  handle('settings:reset', () => context().settings.reset())

  handle('secrets:status', () => {
    const s = context().secrets
    return { anthropicApiKey: s.has('anthropicApiKey'), encryptionAvailable: s.available() }
  })
  handle('secrets:set', (key, value) => {
    const s = context().secrets
    s.set(key, value)
    log.info(`secret ${key} ${value ? 'set' : 'cleared'}`)
    return { anthropicApiKey: s.has('anthropicApiKey'), encryptionAvailable: s.available() }
  })

  handle('categories:list', () => context().repos.categories.all())
  handle('categories:save', (c) => {
    const repo = context().repos.categories
    const id = c.id.trim() || `custom_${Date.now().toString(36)}`
    repo.upsert({ ...c, id })
    return repo.all()
  })
  handle('categories:remove', (id) => {
    const repo = context().repos.categories
    repo.remove(id)
    return repo.all()
  })
  handle('categories:reset', () => {
    const repo = context().repos.categories
    repo.reset(DEFAULT_CATEGORIES)
    return repo.all()
  })

  handle('shell:reveal', (p) => platform().reveal(p))
  handle('shell:openLogs', async () => {
    const dir = context().paths.logs
    await fs.mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })

  handle('cache:clear', async () => {
    const c = context()
    let thumbs = 0
    try {
      const files = await fs.readdir(c.paths.thumbs)
      thumbs = files.length
      // App-owned cache directory: removing it is allowed (it is not a user file).
      await fs.rm(c.paths.thumbs, { recursive: true, force: true })
    } catch {
      /* nothing cached */
    }
    const ai = c.repos.aiCache.count()
    c.repos.aiCache.clear()
    log.info(`cache cleared thumbs=${thumbs} ai=${ai}`)
    return { thumbs, ai }
  })
}
