import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../src/shared/settings'
import { inlineRunner } from '../../src/main/core/pool'
import { runScan } from '../../src/main/core/scanner/session'
import { planFromSession } from '../../src/main/core/planner/session'
import { makePng } from '../../scripts/fixtures/binary'
import { memoryRepos } from '../helpers/db'
import { stubThumbnailer, tempDir } from '../helpers/scan'

/**
 * Performance check (docs/01 §5: 20k files in < 10 min). Opt-in: DONDU_BENCH=1 npm test.
 * Uses a synthetic tree of small files; prints timings.
 */
describe.runIf(process.env['DONDU_BENCH'] === '1')('performance', () => {
  it(
    'scans and plans 20,000 files',
    async () => {
      const root = path.join(await tempDir('dondu-bench-'), 'Masaüstü')
      const png = makePng(32, 24, (x, y) => [x * 8, y * 10, 128])
      const t0 = Date.now()
      const N = 20_000
      for (let d = 0; d < 200; d++) {
        const dir = path.join(root, `klasor-${d}`, d % 3 ? 'alt' : '')
        await fs.mkdir(dir, { recursive: true })
        const writes: Promise<void>[] = []
        for (let i = 0; i < N / 200; i++) {
          const k = d * 100 + i
          const kind = k % 5
          const name =
            kind === 0
              ? `IMG_${k}.png`
              : kind === 1
                ? `fatura_${2015 + (k % 10)}_${k}.txt`
                : kind === 2
                  ? `not-${k}.md`
                  : kind === 3
                    ? `rapor ${k}.csv`
                    : `veri-${k % 500}.json` // many duplicates by content
          const data =
            kind === 0
              ? png
              : kind === 4
                ? `{"v":${k % 500}}`.padEnd(2048, ' ')
                : `içerik ${k}\n`.repeat(20)
          writes.push(fs.writeFile(path.join(dir, name), data))
        }
        await Promise.all(writes)
      }
      const tGen = Date.now() - t0

      const repos = memoryRepos()
      const settings = defaultSettings()
      const t1 = Date.now()
      const summary = await runScan(
        {
          repos,
          runner: inlineRunner(8),
          thumbnailer: stubThumbnailer,
          thumbsDir: path.join(root, '..', 'thumbs'),
        },
        { roots: [root], settings },
      )
      const tScan = Date.now() - t1
      const t2 = Date.now()
      const plan = planFromSession(repos, summary.sessionId, settings)
      const tPlan = Date.now() - t2
      console.log(
        `generate ${tGen} ms · scan ${tScan} ms · plan ${tPlan} ms · items ${plan.items.length}`,
      )
      expect(summary.totalFiles).toBe(N)
      expect(tScan).toBeLessThan(10 * 60 * 1000)
      expect(tPlan).toBeLessThan(60 * 1000)
    },
    20 * 60 * 1000,
  )
})
