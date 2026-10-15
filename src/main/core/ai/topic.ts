import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { CONTENT_KINDS, isContentKind, type ContentKind } from '@shared/kinds'
import { pricesFor } from '@shared/models'
import type { Settings } from '@shared/settings'
import type { AIEstimate, FileMeta, FileRecord } from '@shared/types'
import type { FolderPref, Repos } from '../../db/repos'
import { sanitizeRelDir, sanitizeSegment } from '../naming'
import {
  eventTitle,
  rulePlacement,
  type Organization,
  type Placement,
  type Unit,
} from '../organize'
import { isGenericDirName } from '../organize/signals'
import { kindOf } from '../organize/units'
import { classifyFile, fold } from '../rules'
import { estimateRun, usageCost, type CostBreakdown } from './cost'
import { buildInput } from './input'
import { contentKey } from './runner'
import {
  ProviderError,
  RetryableError,
  type AIProvider,
  type JsonRequest,
  type Usage,
} from './types'
import { abortableSleep } from './util'
import understandMd from '../../../../docs/prompts/understand-system.md?raw'
import understandSchema from '../../../../docs/prompts/understand-schema.json'
import organizeMd from '../../../../docs/prompts/organize-system.md?raw'
import organizeSchema from '../../../../docs/prompts/organize-schema.json'

/**
 * Revision 1 — "understand first, then organise":
 *  1. understanding pass (cheap model, vision): each unit → title, topic, content kind
 *  2. folder architect (smarter model, few calls): groups of units → a topic-first folder tree
 * Units the AI never sees (sensitive files with a cloud provider, failed batches) keep their rule
 * placement. Nothing here touches the file system except reading cached thumbnails.
 */

const version = (md: string): number => Number(/PROMPT_VERSION:\s*(\d+)/.exec(md)?.[1] ?? '1')
export const UNDERSTAND_VERSION = version(understandMd)
export const ORGANIZE_VERSION = version(organizeMd)
const body = (md: string): string =>
  md
    .split(/\n---\n/)
    .slice(1)
    .join('\n---\n')
    .trim()

export function understandSystem(): string {
  return body(understandMd).replace(
    '{{KINDS}}',
    CONTENT_KINDS.map((k) => `   - \`${k}\``).join('\n'),
  )
}

export function organizeSystem(settings: Settings): string {
  return body(organizeMd)
    .replaceAll('{{MAX_DEPTH}}', String(settings.organize.maxDepth))
    .replaceAll('{{QUARANTINE}}', settings.quarantineFolderName)
}

export interface Understanding {
  unitId: string
  title: string
  topic: string
  kind: ContentKind
  dateHint?: string
  sensitive: boolean
  keepTogether?: boolean
  confidence: number
  reason: string
}

export interface TopicDeps {
  repos: Repos
  provider: AIProvider
  settings: Settings
}

export interface TopicRunResult {
  organization: Organization
  summary: {
    files: number
    tokensIn: number
    tokensOut: number
    usd: number
    failedBatches: number
  }
}

type Progress = (phase: 'ai' | 'organize', done: number, total: number, usd: number) => void

// ---------------------------------------------------------------------------- describing units

const fmtDate = (t: number): string => new Date(t).toISOString().slice(0, 16).replace('T', ' ')
const parentRel = (rel: string): string =>
  rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
const where = (rel: string): string => parentRel(rel) || '(kök)'

interface Ctx {
  files: Map<string, FileRecord>
  metas: Map<string, FileMeta>
  settings: Settings
  provider: AIProvider
}

function allowImages(c: Ctx): boolean {
  const s = c.settings
  return (
    c.provider.supportsVision &&
    s.images.analyzeWithAI &&
    s.ai.mode !== 'metadataOnly' &&
    (!c.provider.isCloud || s.organize.cloudImages)
  )
}

/** Names shown to a cloud model never include sensitive files. */
const visibleMembers = (u: Unit, c: Ctx): FileRecord[] =>
  u.memberIds
    .map((id) => c.files.get(id))
    .filter((f): f is FileRecord => !!f && !(c.provider.isCloud && f.sensitive))

async function describeUnit(
  u: Unit,
  alias: string,
  c: Ctx,
): Promise<{ text: string; images: { label: string; base64: string }[] }> {
  const lines = [`id: ${alias}`, `type: ${u.type}`]
  const images: { label: string; base64: string }[] = []
  const readThumb = async (f: FileRecord | undefined): Promise<string | undefined> => {
    const p = f ? c.metas.get(f.id)?.thumbPath : undefined
    if (!p || !f || f.sensitive) return undefined
    try {
      return (await fs.readFile(p)).toString('base64')
    } catch {
      return undefined
    }
  }
  const members = visibleMembers(u, c)
  if (u.type === 'file') {
    const f = c.files.get(u.memberIds[0]!)!
    const input = await buildInput(alias, f, c.metas.get(f.id) ?? {}, c.settings, {
      allowImage: false,
      allowExcerpt: c.settings.ai.mode !== 'metadataOnly',
    })
    lines.push(`name: ${f.name}`, `location: ${where(f.relPath)}`, `kind hint: ${u.kindHint}`)
    lines.push(`details: ${input.metaSummary}; modified ${input.mtimeIso}`)
    if (input.textExcerpt)
      lines.push(`excerpt: ${input.textExcerpt.replace(/\s+/g, ' ').slice(0, 900)}`)
  } else if (u.type === 'folder') {
    const ext = new Map<string, number>()
    for (const m of members) ext.set(m.ext || '-', (ext.get(m.ext || '-') ?? 0) + 1)
    const hist = [...ext.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([e, n]) => `${n} ${e}`)
      .join(', ')
    const subs = [
      ...new Set(
        members
          .map((m) => m.relPath.slice(u.relPath.length + 1))
          .filter((r) => r.includes('/'))
          .map((r) => r.slice(0, r.indexOf('/'))),
      ),
    ].slice(0, 8)
    const examples = members.slice(0, 12).map((m) => m.relPath.slice(u.relPath.length + 1))
    lines.push(
      `name: ${path.posix.basename(u.relPath)}`,
      `location: ${where(u.relPath)}`,
      `kind hint: ${u.kindHint}`,
    )
    lines.push(
      `details: ${u.memberIds.length} files (${hist})${subs.length ? `; sub-folders: ${subs.join(', ')}` : ''}; examples: ${examples.join(', ')}`,
    )
  } else {
    const photos = members.filter((m) => m.family === 'image').length
    const videos = members.filter((m) => m.family === 'video').length
    const cams = [...new Set(members.map((m) => c.metas.get(m.id)?.camera).filter(Boolean))].slice(
      0,
      3,
    )
    const gps = members.some((m) => c.metas.get(m.id)?.hasGps)
    lines.push(`name: ${u.label}`, `location: ${where(u.relPath)}`, `kind hint: photo`)
    lines.push(
      `details: ${u.memberIds.length} items (${photos} photos, ${videos} videos) between ${fmtDate(u.dateFrom ?? 0)} and ${fmtDate(u.dateTo ?? 0)}${cams.length ? `; camera: ${cams.join(', ')}` : ''}; GPS: ${gps ? 'yes' : 'no'}`,
    )
  }
  if (allowImages(c)) {
    const max = u.type === 'event' ? 4 : u.type === 'folder' ? 2 : 1
    const ids = u.sampleIds.slice(0, max)
    let n = 0
    for (const id of ids) {
      const b64 = await readThumb(c.files.get(id))
      if (b64) images.push({ label: `Thumbnail ${alias} (${++n}/${ids.length}):`, base64: b64 })
    }
  }
  return { text: lines.join('\n'), images }
}

/** Content key of a unit for the cache: same files (and same folder name) → same answer. */
export function unitKey(u: Unit, files: Map<string, FileRecord>): string {
  const keys = u.memberIds.map((id) => {
    const f = files.get(id)
    return f ? contentKey(f) : id
  })
  // Names matter too: two copies with different names get their own titles.
  const name = u.type === 'event' ? '' : (u.relPath.split('/').pop() ?? '')
  const h = createHash('sha1').update(`${u.type}|${name}|${keys.sort().join(',')}`)
  return h.digest('hex')
}

// ---------------------------------------------------------------------------- selection

/** Units worth asking the AI about. */
export function unitsForAi(org: Organization, c: Ctx): Unit[] {
  return [...org.units.values()].filter((u) => {
    const members = u.memberIds.map((id) => c.files.get(id)).filter((f): f is FileRecord => !!f)
    if (!members.length) return false
    if (u.type === 'file') {
      const f = members[0]!
      if (f.size === 0) return false
      if (c.provider.isCloud && f.sensitive) return false // golden rule 6
      if (classifyFile(f, c.metas.get(f.id) ?? {}, c.settings).category === 'junk') return false
    }
    // A folder or event made only of sensitive files never goes to the cloud either.
    if (c.provider.isCloud && members.every((m) => m.sensitive)) return false
    return true
  })
}

// ---------------------------------------------------------------------------- batching

interface Batch<T> {
  items: T[]
}

async function runBatches<T, R>(
  batches: Batch<T>[],
  concurrency: number,
  signal: AbortSignal,
  call: (b: Batch<T>) => Promise<R>,
  accept: (b: Batch<T>, r: R) => void,
  onDone: () => void,
): Promise<{ failed: number }> {
  let next = 0
  let failed = 0
  let fatal: Error | null = null
  const worker = async (): Promise<void> => {
    while (next < batches.length && !fatal && !signal.aborted) {
      const b = batches[next++]!
      for (let attempt = 1; ; attempt++) {
        try {
          accept(b, await call(b))
          break
        } catch (e) {
          if (signal.aborted) return
          if (e instanceof ProviderError && (e.code === 'auth' || e.code === 'unreachable')) {
            fatal = e
            return
          }
          if (e instanceof RetryableError && attempt < 5) {
            await abortableSleep(
              e.retryAfterMs ?? Math.min(30_000, 1000 * 2 ** (attempt - 1)),
              signal,
            )
            continue
          }
          failed++
          break
        }
      }
      onDone()
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
  if (fatal) throw fatal
  return { failed }
}

// ---------------------------------------------------------------------------- understanding

const understandOut = z.object({
  id: z.string(),
  title: z.string(),
  topic: z.string(),
  kind: z.string(),
  date_hint: z.string().optional(),
  sensitive: z.boolean(),
  keep_together: z.boolean().optional(),
  confidence: z.number(),
  reason: z.string(),
})

export function parseUnderstanding(raw: unknown, aliases: Map<string, Unit>): Understanding[] {
  const arr =
    raw && typeof raw === 'object' && Array.isArray((raw as { results?: unknown }).results)
      ? (raw as { results: unknown[] }).results
      : []
  const out: Understanding[] = []
  const seen = new Set<string>()
  for (const r of arr) {
    const p = understandOut.safeParse(r)
    if (!p.success) continue
    const u = aliases.get(p.data.id)
    if (!u || seen.has(p.data.id)) continue
    seen.add(p.data.id)
    const d = p.data
    out.push({
      unitId: u.id,
      title: d.title.trim().slice(0, 80) || u.label,
      topic: d.topic.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').slice(0, 60),
      kind: isContentKind(d.kind) ? d.kind : u.kindHint,
      dateHint: d.date_hint && /^\d{4}(-\d{2})?$/.test(d.date_hint) ? d.date_hint : undefined,
      sensitive: d.sensitive,
      keepTogether: d.keep_together,
      confidence: Math.min(1, Math.max(0, d.confidence)),
      reason: d.reason.slice(0, 200),
    })
  }
  return out
}

function batchUnits<T extends { images: unknown[] }>(units: T[], size: number): Batch<T>[] {
  const out: Batch<T>[] = []
  let cur: T[] = []
  let imgs = 0
  for (const x of units) {
    const limit = imgs + x.images.length > 0 ? Math.min(6, size) : size
    if (cur.length >= limit || imgs + x.images.length > 20) {
      out.push({ items: cur })
      cur = []
      imgs = 0
    }
    cur.push(x)
    imgs += x.images.length
  }
  if (cur.length) out.push({ items: cur })
  return out
}

async function understand(
  deps: TopicDeps,
  units: Unit[],
  c: Ctx,
  signal: AbortSignal,
  usage: Usage,
  onProgress: (done: number, total: number) => void,
): Promise<{ results: Map<string, Understanding>; failed: number; sent: number }> {
  const { provider, settings, repos } = deps
  const results = new Map<string, Understanding>()
  const keyOf = (u: Unit): string =>
    [
      'un',
      unitKey(u, c.files),
      `v${UNDERSTAND_VERSION}`,
      provider.id,
      provider.model,
      allowImages(c) ? 'img' : 'noimg',
      settings.ai.mode,
    ].join('|')
  const todo: {
    u: Unit
    text: string
    images: { label: string; base64: string }[]
    alias: string
    key: string
  }[] = []
  let n = 0
  for (const u of units) {
    const key = keyOf(u)
    const hit = settings.ai.cacheEnabled ? repos.aiCache.get(key) : undefined
    if (hit) {
      results.set(u.id, { ...(hit.result as Understanding), unitId: u.id })
      continue
    }
    if (signal.aborted) break
    const alias = `u_${String(++n).padStart(4, '0')}`
    const d = await describeUnit(u, alias, c)
    todo.push({ u, alias, key, ...d })
  }
  const batches = batchUnits(todo, Math.min(settings.ai.batchSize, provider.batchSize))
  let done = 0
  onProgress(0, batches.length)
  const system = understandSystem()
  const { failed } = await runBatches(
    batches,
    provider.concurrency,
    signal,
    (b) => {
      const req: JsonRequest = {
        pass: 'understand',
        system,
        text: `Describe these ${b.items.length} items. Return JSON {"results": [...]}, one result per id.\n\n${b.items.map((x) => x.text).join('\n\n')}`,
        images: b.items.flatMap((x) => x.images),
        schema: understandSchema,
        maxTokens: 8000,
      }
      return provider.json(req, signal)
    },
    (b, r) => {
      add(usage, r.usage)
      const aliases = new Map(b.items.map((x) => [x.alias, x.u]))
      const keys = new Map(b.items.map((x) => [x.u.id, x.key]))
      for (const und of parseUnderstanding(r.json, aliases)) {
        results.set(und.unitId, und)
        if (settings.ai.cacheEnabled) repos.aiCache.set(keys.get(und.unitId)!, und, 0, 0)
      }
    },
    () => onProgress(++done, batches.length),
  )
  return { results, failed, sent: todo.length }
}

const add = (a: Usage, b: Usage): void => {
  a.tokensIn += b.tokensIn
  a.tokensOut += b.tokensOut
  a.cacheWrite += b.cacheWrite
  a.cacheRead += b.cacheRead
}

// ---------------------------------------------------------------------------- groups + architect

export interface Group {
  id: string
  root: string
  unitIds: string[]
  kind: ContentKind
  topic: string
  line: string
}

/** Folder and event units are their own groups; loose files group by (kind, topic). */
export function buildGroups(
  org: Organization,
  understood: Map<string, Understanding>,
  files: Map<string, FileRecord>,
): Map<string, Group[]> {
  const byRoot = new Map<string, Group[]>()
  const loose = new Map<
    string,
    { root: string; kind: ContentKind; topic: string; units: Unit[]; titles: string[] }
  >()
  let n = 0
  const push = (g: Omit<Group, 'id'>): void => {
    const list = byRoot.get(g.root) ?? []
    list.push({ ...g, id: `g${++n}` })
    byRoot.set(g.root, list)
  }
  const years = (us: Unit[], und?: Understanding[]): string => {
    const ys = new Set<string>()
    for (const d of und ?? []) if (d.dateHint) ys.add(d.dateHint.slice(0, 4))
    for (const u of us) {
      if (u.dateFrom) ys.add(String(new Date(u.dateFrom).getFullYear()))
      else {
        const f = files.get(u.memberIds[0] ?? '')
        if (f && !ys.size) ys.add(String(new Date(f.mtime).getFullYear()))
      }
    }
    const s = [...ys].sort()
    return s.length > 1 ? `${s[0]}–${s[s.length - 1]}` : (s[0] ?? '?')
  }
  for (const u of org.units.values()) {
    const d = understood.get(u.id)
    if (!d) continue
    if (u.type === 'folder' || u.type === 'event') {
      const head =
        u.type === 'folder'
          ? `folder "${path.posix.basename(u.relPath)}" | ${u.memberIds.length} files`
          : `event | ${u.memberIds.length} items`
      push({
        root: u.root,
        unitIds: [u.id],
        kind: d.kind,
        topic: d.topic,
        line: `${head} | kind: ${d.kind} | topic: ${d.topic} | title: ${d.title} | dates: ${years([u], [d])} | now in: ${where(u.relPath)}`,
      })
      continue
    }
    const key = `${u.root}\u0000${d.kind}\u0000${fold(d.topic)}`
    const g = loose.get(key) ?? {
      root: u.root,
      kind: d.kind,
      topic: d.topic,
      units: [],
      titles: [],
    }
    g.units.push(u)
    if (g.titles.length < 5) g.titles.push(d.title)
    loose.set(key, g)
  }
  for (const g of loose.values()) {
    const und = g.units.map((u) => understood.get(u.id)!).filter(Boolean)
    const from = [...new Set(g.units.map((u) => where(u.relPath)))].slice(0, 3).join(', ')
    push({
      root: g.root,
      unitIds: g.units.map((u) => u.id),
      kind: g.kind,
      topic: g.topic,
      line: `files | ${g.units.length} items | kind: ${g.kind} | topic: ${g.topic} | examples: ${g.titles.map((t) => `"${t}"`).join(', ')} | dates: ${years(g.units, und)} | now in: ${from}`,
    })
  }
  return byRoot
}

const organizeOut = z.object({
  folders: z.array(z.object({ path: z.string(), purpose: z.string() })).default([]),
  placements: z.array(z.object({ group: z.string(), folder: z.string(), reason: z.string() })),
})

/** Cleans a folder path from the architect: sanitized, relative, depth-capped, never quarantine. */
export function cleanFolder(raw: string, root: string, settings: Settings): string | null {
  let p = raw.trim().replace(/\\/g, '/')
  if (p === '.' || p === './' || p === '') return '.'
  const rootName = path.basename(root)
  if (p.split('/')[0] === rootName) p = p.split('/').slice(1).join('/')
  let rel = sanitizeRelDir(p)
  const segs = rel.split('/').filter(Boolean).slice(0, settings.organize.maxDepth)
  rel = segs.join('/')
  if (!rel) return '.'
  if (fold(segs[0]!) === fold(sanitizeSegment(settings.quarantineFolderName))) return null
  return rel
}

/** Existing folder structure under a root (2 levels), for the architect to reuse. */
export function existingFolders(
  files: FileRecord[],
  root: string,
  unitFolders: Set<string>,
): string[] {
  const insideUnit = (rel: string): boolean =>
    [...unitFolders].some((u) => rel === u || rel.startsWith(`${u}/`))
  return files
    .filter(
      (f) =>
        f.kind === 'dir' &&
        f.root === root &&
        f.relPath.split('/').length <= 2 &&
        !insideUnit(f.relPath) &&
        !f.relPath.split('/').some((seg) => isGenericDirName(seg)),
    )
    .map((f) => f.relPath)
    .sort()
    .slice(0, 150)
}

async function architect(
  deps: TopicDeps,
  root: string,
  groups: Group[],
  existing: string[],
  prefs: FolderPref[],
  signal: AbortSignal,
  usage: Usage,
  onProgress: (done: number, total: number) => void,
): Promise<{ folderOf: Map<string, { folder: string; reason: string }>; failed: number }> {
  const { provider, settings, repos } = deps
  const folderOf = new Map<string, { folder: string; reason: string }>()
  const chunks: Batch<Group>[] = []
  for (let i = 0; i < groups.length; i += 250) chunks.push({ items: groups.slice(i, i + 250) })
  const chosen = new Set<string>()
  let done = 0
  onProgress(0, chunks.length)
  const system = organizeSystem(settings)
  let failed = 0
  // Chunks run one after another so later chunks reuse the folders chosen earlier.
  for (const chunk of chunks) {
    if (signal.aborted) break
    const text = [
      `Folder being organised: ${path.basename(root)}`,
      `Existing folders (reuse when they fit):\n${[...new Set([...existing, ...chosen])].map((f) => `- ${f}`).join('\n') || '- (none)'}`,
      `The person's earlier choices:\n${prefs.map((p) => `- topic "${p.topic}" (${p.kind}) → ${p.folder}`).join('\n') || '- (none)'}`,
      settings.organize.hint ? `Hint from the person: ${settings.organize.hint}` : '',
      `Groups:\n${chunk.items.map((g) => `${g.id} | ${g.line}`).join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n')
    const key = [
      'org',
      createHash('sha1').update(text).digest('hex'),
      `v${ORGANIZE_VERSION}`,
      provider.id,
      provider.organizerModel,
    ].join('|')
    const hit = settings.ai.cacheEnabled ? repos.aiCache.get(key) : undefined
    let json: unknown = hit?.result
    if (!hit) {
      const r = await runBatches(
        [chunk],
        1,
        signal,
        () =>
          provider.json(
            { pass: 'organize', system, text, schema: organizeSchema, maxTokens: 16000 },
            signal,
          ),
        (_b, res) => {
          add(usage, res.usage)
          json = res.json
        },
        () => undefined,
      )
      failed += r.failed
      if (json !== undefined && settings.ai.cacheEnabled) repos.aiCache.set(key, json, 0, 0)
    }
    const parsed = organizeOut.safeParse(json)
    if (parsed.success) {
      const ids = new Set(chunk.items.map((g) => g.id))
      for (const p of parsed.data.placements) {
        if (!ids.has(p.group) || folderOf.has(p.group)) continue
        const folder = cleanFolder(p.folder, root, settings)
        if (folder === null) continue
        folderOf.set(p.group, { folder, reason: p.reason.slice(0, 200) })
        if (folder !== '.') chosen.add(folder)
      }
    } else if (json !== undefined) failed++
    onProgress(++done, chunks.length)
  }
  return { folderOf, failed }
}

// ---------------------------------------------------------------------------- run + estimate

/**
 * Runs both passes and returns the organization with AI placements merged over the rule ones.
 * A stop (signal) keeps what is done so far; anything without an AI answer keeps its rule placement.
 */
export async function runTopicAi(
  deps: TopicDeps,
  org: Organization,
  allFiles: FileRecord[],
  metas: Map<string, FileMeta>,
  signal: AbortSignal,
  onProgress: Progress = () => undefined,
): Promise<TopicRunResult> {
  const { provider, settings, repos } = deps
  const files = new Map(allFiles.map((f) => [f.id, f]))
  const c: Ctx = { files, metas, settings, provider }
  // Each pass is priced at its own model's rates.
  const usageU: Usage = { tokensIn: 0, tokensOut: 0, cacheWrite: 0, cacheRead: 0 }
  const usageO: Usage = { tokensIn: 0, tokensOut: 0, cacheWrite: 0, cacheRead: 0 }
  const spent = (): number =>
    provider.id === 'anthropic'
      ? usageCost(usageU, false, pricesFor(provider.model)) +
        usageCost(usageO, false, pricesFor(provider.organizerModel))
      : 0

  const est = await estimateTopicAi(deps, org, allFiles, metas)
  if (est.overLimit) throw new ProviderError('over_limit', 'other')

  // Pass 1: understand.
  const selected = unitsForAi(org, c)
  const first = await understand(deps, selected, c, signal, usageU, (d, t) =>
    onProgress('ai', d, t, spent()),
  )
  let failed = first.failed
  const understood = first.results

  // Folders the AI calls a random dump are dissolved: their files are understood one by one.
  const dissolve = [...org.units.values()].filter(
    (u) =>
      u.type === 'folder' &&
      understood.get(u.id)?.keepTogether === false &&
      settings.organize.existingFolders !== 'keep',
  )
  if (dissolve.length && !signal.aborted) {
    const singles: Unit[] = []
    for (const u of dissolve) {
      org.units.delete(u.id)
      understood.delete(u.id)
      org.placements.delete(u.id)
      for (const id of u.memberIds) {
        const f = files.get(id)
        if (!f) continue
        const single: Unit = {
          id: `f:${f.id}`,
          type: 'file',
          root: f.root,
          memberIds: [f.id],
          relPath: f.relPath,
          label: f.name,
          kindHint: kindOf(f, metas.get(f.id) ?? {}),
          sampleIds: f.family === 'image' && !f.sensitive ? [f.id] : [],
        }
        org.units.set(single.id, single)
        org.set.unitOf.set(f.id, single.id)
        const rp = rulePlacement(single, files, settings)
        if (rp) org.placements.set(single.id, rp)
        singles.push(single)
      }
    }
    org.set.units = [...org.units.values()]
    const second = await understand(
      deps,
      unitsForAi({ ...org, units: new Map(singles.map((s) => [s.id, s])) }, c),
      c,
      signal,
      usageU,
      (d, t) => onProgress('ai', d, t, spent()),
    )
    failed += second.failed
    for (const [k, v] of second.results) understood.set(k, v)
  }

  // Pass 2: the folder architect, per root.
  if (!signal.aborted && understood.size) {
    const groupsByRoot = buildGroups(org, understood, files)
    const unitFolders = new Set(
      [...org.units.values()].filter((u) => u.type === 'folder').map((u) => u.relPath),
    )
    let rootIdx = 0
    for (const [root, groups] of groupsByRoot) {
      if (signal.aborted) break
      const existing = existingFolders(allFiles, root, unitFolders)
      const prefs = repos.folderPrefs.recent(root, 60)
      const res = await architect(deps, root, groups, existing, prefs, signal, usageO, (d, t) =>
        onProgress('organize', rootIdx + d, groupsByRoot.size + t - 1, spent()),
      )
      rootIdx++
      failed += res.failed
      for (const g of groups) {
        const choice = res.folderOf.get(g.id)
        if (!choice) continue
        for (const uid of g.unitIds) {
          const u = org.units.get(uid)
          const d = understood.get(uid)
          if (!u || !d) continue
          const placement: Placement = {
            unitId: uid,
            relDir: choice.folder === '.' ? parentRel(u.relPath) : choice.folder,
            kind: d.kind,
            title: u.type === 'event' && !d.title ? eventTitle(u) : d.title,
            topic: d.topic,
            confidence: d.confidence,
            reason: d.reason || choice.reason,
            source: 'ai',
            keepInPlace: u.type === 'folder' && choice.folder === '.',
            sensitive: d.sensitive,
          }
          // A file unit placed "." means: leave it where it is.
          if (u.type !== 'folder' && choice.folder === '.') placement.relDir = parentRel(u.relPath)
          org.placements.set(uid, placement)
        }
      }
    }
  }

  return {
    organization: org,
    summary: {
      files: first.sent,
      tokensIn: [usageU, usageO].reduce((a, u) => a + u.tokensIn + u.cacheWrite + u.cacheRead, 0),
      tokensOut: usageU.tokensOut + usageO.tokensOut,
      usd: spent(),
      failedBatches: failed,
    },
  }
}

export async function estimateTopicAi(
  deps: TopicDeps,
  org: Organization,
  allFiles: FileRecord[],
  metas: Map<string, FileMeta>,
): Promise<AIEstimate> {
  const { provider, settings, repos } = deps
  const files = new Map(allFiles.map((f) => [f.id, f]))
  const c: Ctx = { files, metas, settings, provider }
  const units = unitsForAi(org, c)
  let cached = 0
  let withImages = 0
  const pseudo: {
    id: string
    name: string
    ext: string
    sizeBytes: number
    mtimeIso: string
    kind: 'file'
    metaSummary: string
    textExcerpt?: string
    imageJpegBase64?: string
  }[] = []
  for (const u of units) {
    const key = [
      'un',
      unitKey(u, files),
      `v${UNDERSTAND_VERSION}`,
      provider.id,
      provider.model,
      allowImages(c) ? 'img' : 'noimg',
      settings.ai.mode,
    ].join('|')
    if (settings.ai.cacheEnabled && repos.aiCache.get(key)) {
      cached++
      continue
    }
    const imgs = allowImages(c)
      ? Math.min(u.sampleIds.length, u.type === 'event' ? 4 : u.type === 'folder' ? 2 : 1)
      : 0
    if (imgs) withImages++
    const f = files.get(u.memberIds[0] ?? '')
    const excerpt = u.type === 'file' && f ? metas.get(f.id)?.textExcerpt : undefined
    // One pseudo-input per unit; extra thumbnails are added as extra pseudo-inputs.
    pseudo.push({
      id: u.id,
      name: u.label,
      ext: '',
      sizeBytes: 0,
      mtimeIso: '',
      kind: 'file',
      metaSummary: 'x'.repeat(u.type === 'file' ? 160 : 360),
      textExcerpt: excerpt?.slice(0, 900),
      imageJpegBase64: imgs ? 'x' : undefined,
    })
    for (let i = 1; i < imgs; i++)
      pseudo.push({
        id: `${u.id}#${i}`,
        name: '',
        ext: '',
        sizeBytes: 0,
        mtimeIso: '',
        kind: 'file',
        metaSummary: '',
        imageJpegBase64: 'x',
      })
  }
  const requests =
    Math.ceil(
      pseudo.length / Math.min(settings.ai.batchSize, provider.batchSize, withImages ? 6 : 99),
    ) || 0
  const understandCost: CostBreakdown =
    provider.id === 'anthropic'
      ? estimateRun(pseudo, requests, {
          imageEdge: settings.images.thumbnailMaxEdge,
          prices: pricesFor(provider.model),
        })
      : estimateRun(pseudo, requests)
  // Architect: ~45 tokens per group line in, ~30 out, plus the system prompt; groups ≈ units/3.
  const groups = Math.max(1, Math.ceil(units.length / 3))
  const archIn = 1500 + groups * 45
  const archOut = 600 + groups * 30
  const op = pricesFor(provider.organizerModel)
  const archUsd =
    provider.id === 'anthropic' ? (archIn * op.input + archOut * op.output) / 1_000_000 : 0
  const usd = (provider.id === 'anthropic' ? understandCost.usd : 0) + archUsd
  const tokensIn = understandCost.tokensIn + archIn
  const tokensOut = understandCost.tokensOut + archOut
  const overUsd = provider.id === 'anthropic' && usd > settings.ai.maxUsdPerRun
  const overTokens = tokensIn + tokensOut > settings.ai.maxTokensPerRun
  return {
    provider: provider.id,
    model: provider.model,
    files: units.length - cached,
    cachedFiles: cached,
    withImages,
    tokensIn,
    tokensOut,
    usd,
    overLimit: overUsd || overTokens,
    limitReason: overUsd ? 'usd' : overTokens ? 'tokens' : undefined,
  }
}
