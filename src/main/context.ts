import path from 'node:path'
import type { Repos } from './db/repos'
import type { TaskRunner } from './core/pool'
import type { Thumbnailer } from './core/scanner/session'
import type { SettingsStore } from './settings'
import type { SecretStore } from './settings/secrets'

/** Everything the IPC handlers need. Created once in main/index.ts. */
export interface AppContext {
  repos: Repos
  settings: SettingsStore
  secrets: SecretStore
  runner: TaskRunner
  thumbnailer?: Thumbnailer
  paths: {
    userData: string
    cache: string
    thumbs: string
    logs: string
    db: string
  }
  dbBackend: string
  isDev: boolean
}

let ctx: AppContext | null = null

export function setContext(c: AppContext): void {
  ctx = c
}

export function context(): AppContext {
  if (!ctx) throw new Error('App context not initialised')
  return ctx
}

export function appPaths(userData: string): AppContext['paths'] {
  const cache = path.join(userData, 'cache')
  return {
    userData,
    cache,
    thumbs: path.join(cache, 'thumbs'),
    logs: path.join(userData, 'logs'),
    db: path.join(userData, 'dondu.sqlite'),
  }
}
