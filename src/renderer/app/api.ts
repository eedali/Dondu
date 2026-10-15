import type { DonduApi } from '@shared/api'

export const api: DonduApi = window.dondu

/** Electron wraps IPC errors as "Error invoking remote method 'x': Error: msg" — keep msg. */
export function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const m = /Error invoking remote method '[^']+': (?:\w*Error: )?(.*)$/s.exec(raw)
  return (m?.[1] ?? raw).trim()
}

/** Thumbnail URL served by the main process (only from the app's cache folder). */
export function thumbUrl(path: string | undefined): string | undefined {
  return path ? `dondu-thumb://${encodeURIComponent(path)}` : undefined
}

/** Shortens a long path for display, keeping the start and the end. */
export function shortPath(p: string, max = 64): string {
  if (p.length <= max) return p
  const keep = Math.floor((max - 1) / 2)
  return `${p.slice(0, keep)}…${p.slice(-keep)}`
}
