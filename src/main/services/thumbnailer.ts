import fs from 'node:fs/promises'
import { nativeImage } from 'electron'
import type { Thumbnailer } from '../core/scanner/session'
import { grayFromBitmap } from '../core/hash'

/**
 * Thumbnails via Electron nativeImage (main process). createThumbnailFromPath uses QuickLook on
 * macOS and shell thumbnails on Windows (HEIC, PDF, Pages, video). Falls back to createFromPath.
 */
export const electronThumbnailer: Thumbnailer = {
  async make(src, maxEdge, outFile) {
    let img: Electron.NativeImage | null = null
    let size: { width: number; height: number } | undefined
    try {
      const full = nativeImage.createFromPath(src)
      if (!full.isEmpty()) size = full.getSize()
    } catch {
      /* not decodable by Chromium */
    }
    if (process.platform === 'darwin' || process.platform === 'win32') {
      try {
        img = await nativeImage.createThumbnailFromPath(src, { width: maxEdge, height: maxEdge })
      } catch {
        img = null
      }
    }
    if (!img || img.isEmpty()) {
      const full = nativeImage.createFromPath(src)
      if (full.isEmpty()) return null
      const s = full.getSize()
      const scale = Math.min(1, maxEdge / Math.max(s.width, s.height))
      img = full.resize({
        width: Math.max(1, Math.round(s.width * scale)),
        height: Math.max(1, Math.round(s.height * scale)),
        quality: 'good',
      })
    }
    await fs.writeFile(outFile, img.toJPEG(80))
    const tiny = img.resize({ width: 9, height: 8, quality: 'good' })
    const gray = grayFromBitmap(tiny.toBitmap(), 9, 8, 'bgra')
    return { width: size?.width, height: size?.height, gray9x8: gray }
  },
}
