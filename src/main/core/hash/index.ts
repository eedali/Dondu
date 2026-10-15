import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { createBLAKE3, createXXHash3 } from 'hash-wasm'
import { longPath } from '../platform/paths'

const EDGE = 64 * 1024

/**
 * Fast fingerprint: xxh3-64 over size + first 64 KB + last 64 KB (whole file when small).
 * Used to find duplicate candidates cheaply; never trusted alone.
 */
export async function fastHash(file: string, size?: number): Promise<string> {
  const fh = await fs.open(longPath(file), 'r')
  try {
    const total = size ?? (await fh.stat()).size
    const h = await createXXHash3()
    h.init()
    h.update(String(total))
    if (total <= EDGE * 2) {
      const buf = Buffer.alloc(total)
      if (total) await fh.read(buf, 0, total, 0)
      h.update(buf)
    } else {
      const head = Buffer.alloc(EDGE)
      const tail = Buffer.alloc(EDGE)
      await fh.read(head, 0, EDGE, 0)
      await fh.read(tail, 0, EDGE, total - EDGE)
      h.update(head)
      h.update(tail)
    }
    return h.digest('hex')
  } finally {
    await fh.close()
  }
}

/** Full-content BLAKE3 (streaming). Used for duplicate confirmation and copy verification. */
export async function fullHash(file: string, signal?: AbortSignal): Promise<string> {
  const h = await createBLAKE3()
  h.init()
  await new Promise<void>((resolve, reject) => {
    const s = createReadStream(longPath(file), { highWaterMark: 1024 * 1024, signal })
    s.on('data', (chunk) => h.update(chunk as Buffer))
    s.on('end', () => resolve())
    s.on('error', reject)
  })
  return h.digest('hex')
}

/** Hash of a directory tree (bundle) — relative paths + sizes + content hashes, sorted. */
export async function treeHash(dir: string): Promise<string> {
  const h = await createBLAKE3()
  h.init()
  const walk = async (d: string, rel: string): Promise<void> => {
    const entries = (await fs.readdir(longPath(d), { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
    for (const e of entries) {
      const p = `${d}/${e.name}`
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isSymbolicLink()) {
        h.update(`L:${r}:${await fs.readlink(p)}\n`)
      } else if (e.isDirectory()) {
        h.update(`D:${r}\n`)
        await walk(p, r)
      } else if (e.isFile()) {
        h.update(`F:${r}:${await fullHash(p)}\n`)
      }
    }
  }
  await walk(dir, '')
  return h.digest('hex')
}

/**
 * Difference hash (dHash) from a 9x8 grayscale buffer (72 bytes). Returns 16 hex chars.
 */
export function dHashFromGray9x8(gray: Uint8Array): string {
  if (gray.length < 72) throw new Error('dHash needs 9x8 pixels')
  let bits = 0n
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = gray[y * 9 + x]!
      const right = gray[y * 9 + x + 1]!
      bits = (bits << 1n) | (left > right ? 1n : 0n)
    }
  }
  return bits.toString(16).padStart(16, '0')
}

/** BGRA/RGBA bitmap (w*h*4) → 9x8 grayscale by box sampling. */
export function grayFromBitmap(
  bitmap: Uint8Array,
  width: number,
  height: number,
  order: 'bgra' | 'rgba' = 'bgra',
): Uint8Array {
  const out = new Uint8Array(72)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 9; x++) {
      const x0 = Math.floor((x * width) / 9)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / 9))
      const y0 = Math.floor((y * height) / 8)
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / 8))
      let sum = 0
      let n = 0
      for (let yy = y0; yy < y1 && yy < height; yy++) {
        for (let xx = x0; xx < x1 && xx < width; xx++) {
          const i = (yy * width + xx) * 4
          const r = order === 'bgra' ? bitmap[i + 2]! : bitmap[i]!
          const g = bitmap[i + 1]!
          const b = order === 'bgra' ? bitmap[i]! : bitmap[i + 2]!
          sum += 0.299 * r + 0.587 * g + 0.114 * b
          n++
        }
      }
      out[y * 9 + x] = n ? Math.round(sum / n) : 0
    }
  }
  return out
}

export function hamming(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}
