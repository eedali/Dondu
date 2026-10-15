/** Human readable byte size (1024 based) with a locale-aware number. */
export function formatBytes(bytes: number, locale = 'tr-TR'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[unit]}`
}
