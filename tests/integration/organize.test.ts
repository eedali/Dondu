import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyPlan } from '../../src/main/core/apply'
import { organizeWithRules } from '../../src/main/core/organize'
import { audioKind, screenshotDevice } from '../../src/main/core/organize/signals'
import { createAdapter } from '../../src/main/core/platform'
import { approvePlan, planFromSession, updatePlanItems } from '../../src/main/core/planner/session'
import { undoRun } from '../../src/main/core/undo'
import type { FileRecord } from '../../src/shared/types'
import { scanFixture } from '../helpers/scan'
import { diffMaps, hashTree } from '../helpers/tree'

const rel = (p: string, root: string): string =>
  path.relative(root, p).split(path.sep).join('/').normalize('NFC')

describe('units and rule placements (revision 1)', () => {
  it('recognises screenshots by device, sounds by kind', async () => {
    const { repos, sessionId } = await scanFixture()
    const files = repos.files.bySession(sessionId)
    const metas = repos.files.metaBySession(sessionId)
    const by = (name: string): FileRecord => files.find((f) => f.name === name)!
    const dev = (name: string) => screenshotDevice(by(name), metas.get(by(name).id) ?? {})
    expect(dev('IMG_5001.PNG')).toBe('phone') // iPhone screenshot named like a photo
    expect(dev('Screenshot_20240305-101112_WhatsApp.png')).toBe('phone')
    expect(dev('Screenshot 2024-03-05 101112.png')).toBe('pc')
    expect(dev('Ekran Resmi 2024-03-12 14.22.31.png')).toBe('pc')
    expect(dev('IMG_1234.JPG')).toBeNull()
    const ak = (name: string) => audioKind(by(name), metas.get(by(name).id) ?? {})
    expect(ak('jump_01.wav')).toBe('sound_effect')
    expect(ak('sarki-demo.wav')).toBe('music')
    expect(ak('sesli not 12.wav')).toBe('voice_note')
  })

  it('keeps coherent folders whole and groups an event', async () => {
    const { repos, sessionId, settings, info } = await scanFixture()
    const files = repos.files.bySession(sessionId)
    const org = organizeWithRules(files, repos.files.metaBySession(sessionId), settings)
    const folders = [...org.units.values()].filter((u) => u.type === 'folder').map((u) => u.relPath)
    expect(folders).toContain(info.topics.gameAssetFolder)
    expect(folders).toContain(info.topics.sfxFolder)
    expect(folders).toContain(info.topics.courseFolder)
    // Generic / container folders are dissolved, not units.
    expect(folders).not.toContain('Yeni Klasör')
    expect(folders).not.toContain('İndirilenler')
    const asset = [...org.units.values()].find((u) => u.relPath === info.topics.gameAssetFolder)!
    expect(asset.kindHint).toBe('game_asset')
    expect([...org.units.values()].find((u) => u.relPath === info.topics.sfxFolder)!.kindHint).toBe(
      'sound_effect',
    )
    const events = [...org.units.values()].filter((u) => u.type === 'event')
    expect(events).toHaveLength(1)
    expect(events[0]!.memberIds).toHaveLength(info.topics.wedding.length)
  })

  it('plans without splitting folders; screenshots, sounds and events get their own folders', async () => {
    const { repos, sessionId, settings, info } = await scanFixture()
    const plan = planFromSession(repos, sessionId, settings)
    const item = (relPath: string) =>
      plan.items.find((i) => rel(i.sourcePath, info.dir) === relPath.normalize('NFC'))
    const target = (relPath: string) => rel(item(relPath)!.targetPath, info.dir)

    // No item for files inside folder units: the folder is one piece (kept in place in rules mode).
    expect(plan.items.some((i) => rel(i.sourcePath, info.dir).startsWith('retro sfx/'))).toBe(false)
    expect(item(info.topics.sfxFolder)!.flags).toContain('folder_unit')
    expect(item(info.topics.sfxFolder)!.action).toBe('skip')

    expect(target('IMG_5001.PNG')).toBe('Ekran Görüntüleri/Telefon/2024/IMG_5001.PNG')
    expect(target('Screenshot 2024-03-05 101112.png')).toMatch(/^Ekran Görüntüleri\/Bilgisayar\//)
    expect(target('jump_01.wav')).toBe('Ses Efektleri/jump_01.wav')
    expect(target('sarki-demo.wav')).toBe('Müzik/sarki-demo.wav')
    for (const w of info.topics.wedding) {
      expect(target(w)).toBe(`Fotoğraflar/2023/2023-06-17/${path.basename(w)}`)
      expect(item(w)!.flags).toContain('event')
    }
    expect(target(info.topics.documentPhotos[0]!)).toMatch(/^Belgeler\/Belge Fotoğrafları\//)
  })

  it('moves a whole folder unit and undoes it in one step', async () => {
    const { repos, sessionId, settings, info } = await scanFixture()
    const before = await hashTree(info.dir)
    const plan = planFromSession(repos, sessionId, settings)
    const folder = plan.items.find(
      (i) => rel(i.sourcePath, info.dir) === info.topics.gameAssetFolder,
    )!
    updatePlanItems(repos, plan.id, [folder.id], {
      targetPath: path.join(info.dir, 'Oyun Geliştirme', info.topics.gameAssetFolder),
      enabled: true,
    })
    const others = plan.items.filter((i) => i.id !== folder.id).map((i) => i.id)
    updatePlanItems(repos, plan.id, others, { enabled: false })
    approvePlan(repos, plan.id)
    const res = await applyPlan({ repos, platform: createAdapter(), settings }, plan.id)
    expect(res.stats.done).toBe(1)
    const after = await hashTree(info.dir)
    expect([...after.keys()]).toContain('Oyun Geliştirme/kenney_platformer-pack/Sprites/player.png')
    expect(repos.journal.byRun(res.runId).filter((r) => r.op === 'rename')).toHaveLength(1)
    await undoRun({ repos, settings }, res.runId)
    expect(diffMaps(before, await hashTree(info.dir))).toEqual([])
  })
})
