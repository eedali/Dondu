import { describe, expect, it } from 'vitest'
import { formatBytes } from '@shared/format'

describe('formatBytes', () => {
  it('formats bytes with Turkish decimal separator', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1,5 KB')
    expect(formatBytes(2.1 * 1024 * 1024)).toBe('2,1 MB')
  })
  it('handles invalid input', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})
