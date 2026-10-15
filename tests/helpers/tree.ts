import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

/** rel path (NFC, posix) → sha1 of content, for every file under `dir`. */
export async function hashTree(
  dir: string,
  opts: { skip?: (rel: string) => boolean } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      const rel = path.relative(dir, p).split(path.sep).join('/').normalize('NFC')
      if (opts.skip?.(rel)) continue
      if (e.isDirectory()) await walk(p)
      else if (e.isFile())
        out.set(
          rel,
          createHash('sha1')
            .update(await fs.readFile(p))
            .digest('hex'),
        )
    }
  }
  await walk(dir)
  return out
}

export function diffMaps(a: Map<string, string>, b: Map<string, string>): string[] {
  const out: string[] = []
  for (const [k, v] of a) if (b.get(k) !== v) out.push(`- ${k}`)
  for (const [k, v] of b) if (a.get(k) !== v) out.push(`+ ${k}`)
  return out.sort()
}

export async function dirExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}
