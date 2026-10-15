import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { defaultSettings, type Settings } from '../../src/shared/settings'
import type { Repos } from '../../src/main/db/repos'
import { inlineRunner } from '../../src/main/core/pool'
import { runScan, type Thumbnailer } from '../../src/main/core/scanner/session'
import { makeFixtures, type FixtureInfo } from '../../scripts/fixtures/make'
import { memoryRepos } from './db'

export async function tempDir(prefix = 'dondu-test-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

/** Writes a tiny placeholder "thumbnail" and a deterministic gray grid (no Electron in tests). */
export const stubThumbnailer: Thumbnailer = {
  async make(src, _edge, out) {
    // Deterministic pseudo-random grid from the content: unrelated files are never "near".
    const digest = createHash('sha512')
      .update(await fs.readFile(src))
      .digest()
    await fs.writeFile(out, 'thumb')
    const gray = new Uint8Array(72).map((_, i) => digest[i % 64]! ^ (i * 37))
    return { width: 10, height: 10, gray9x8: gray }
  },
}

export interface ScannedFixture {
  info: FixtureInfo
  repos: Repos
  sessionId: string
  settings: Settings
  appData: string
}

export async function scanFixture(settingsPatch?: (s: Settings) => void): Promise<ScannedFixture> {
  const root = await tempDir()
  const info = await makeFixtures(path.join(root, 'Masaüstü'))
  const appData = await tempDir('dondu-appdata-')
  const repos = memoryRepos()
  const settings = defaultSettings()
  settingsPatch?.(settings)
  const summary = await runScan(
    {
      repos,
      runner: inlineRunner(4),
      thumbnailer: stubThumbnailer,
      thumbsDir: path.join(appData, 'thumbs'),
    },
    { roots: [info.dir], settings },
  )
  return { info, repos, sessionId: summary.sessionId, settings, appData }
}

/** Sorted "rel:size:mtime" listing of a tree (used to prove read-only behaviour). */
export async function listTree(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      const st = await fs.stat(p)
      out.push(`${path.relative(dir, p)}:${st.size}:${Math.round(st.mtimeMs)}`)
      if (e.isDirectory()) await walk(p)
    }
  }
  await walk(dir)
  return out.sort()
}
