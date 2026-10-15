import { app } from 'electron'
import { handle } from './registry'

export function registerAppIpc(): void {
  handle('app:ping', async () => ({
    pong: true as const,
    platform: process.platform,
    version: app.getVersion(),
  }))
}
