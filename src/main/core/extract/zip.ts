import yauzl from 'yauzl'
import { longPath } from '../platform/paths'

/** Lists up to `limit` entry names (and the total count, if reached cheaply). */
export function listZip(file: string, limit = 50): Promise<{ entries: string[]; count: number }> {
  return new Promise((resolve, reject) => {
    yauzl.open(longPath(file), { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip open failed'))
      const entries: string[] = []
      zip.on('entry', (e: yauzl.Entry) => {
        if (entries.length < limit) entries.push(e.fileName)
        zip.readEntry()
      })
      zip.on('end', () => resolve({ entries, count: zip.entryCount }))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

/** Reads one entry (by exact name or predicate) into memory, up to maxBytes. */
export function readZipEntry(
  file: string,
  match: (name: string) => boolean,
  maxBytes = 4 * 1024 * 1024,
): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(longPath(file), { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip open failed'))
      let done = false
      const finish = (v: Buffer | null): void => {
        if (done) return
        done = true
        zip.close()
        resolve(v)
      }
      zip.on('entry', (e: yauzl.Entry) => {
        if (!match(e.fileName) || e.uncompressedSize > maxBytes) return zip.readEntry()
        zip.openReadStream(e, (e2, stream) => {
          if (e2 || !stream) return finish(null)
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => finish(Buffer.concat(chunks)))
          stream.on('error', () => finish(null))
        })
      })
      zip.on('end', () => finish(null))
      zip.on('error', () => finish(null))
      zip.readEntry()
    })
  })
}
