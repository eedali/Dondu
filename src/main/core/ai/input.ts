import fs from 'node:fs/promises'
import type { Settings } from '@shared/settings'
import type {
  AIClassifyInput,
  AIClassifyOutput,
  Category,
  FileMeta,
  FileRecord,
} from '@shared/types'
import { z } from 'zod'
import { formatBytes } from '@shared/format'

/** docs/03 §5 — one compact description per file. `id` is the batch-local alias (f_0001). */
export async function buildInput(
  alias: string,
  f: FileRecord,
  meta: FileMeta,
  settings: Settings,
  opts: { allowImage: boolean; allowExcerpt: boolean },
): Promise<AIClassifyInput> {
  const parts: string[] = []
  if (meta.width && meta.height) parts.push(`${f.family} ${meta.width}x${meta.height}`)
  else parts.push(f.family)
  if (meta.exifDate) parts.push(`EXIF ${meta.exifDate.slice(0, 16).replace('T', ' ')}`)
  if (meta.camera) parts.push(`camera ${meta.camera}`)
  if (meta.hasGps !== undefined) parts.push(`GPS ${meta.hasGps ? 'yes' : 'no'}`)
  if (meta.pages) parts.push(`${meta.pages} pages`)
  if (meta.title) parts.push(`title "${meta.title.slice(0, 80)}"`)
  if (meta.author) parts.push(`author "${meta.author.slice(0, 40)}"`)
  if (meta.durationSec) parts.push(`duration ${meta.durationSec}s`)
  if (meta.artist) parts.push(`artist "${meta.artist.slice(0, 40)}"`)
  if (meta.scanned) parts.push('scanned (no text layer)')
  if (meta.archiveEntries?.length)
    parts.push(
      `archive: ${meta.archiveEntryCount ?? meta.archiveEntries.length} entries, e.g. ${meta.archiveEntries.slice(0, 8).join(', ')}`,
    )
  if (meta.contents) {
    const c = Object.entries(meta.contents)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([e, n]) => `${n} ${e}`)
      .join(', ')
    parts.push(`contents: ${c}; subfolders: ${meta.subfolders ?? 0}`)
  }
  if (meta.bundleType)
    parts.push(meta.bundleType === 'project' ? 'code project folder' : 'macOS package')

  const input: AIClassifyInput = {
    id: alias,
    name: f.name,
    ext: f.ext,
    sizeBytes: f.size,
    mtimeIso: new Date(f.mtime).toISOString().slice(0, 10),
    kind: f.kind,
    metaSummary: `${parts.join(', ')} · ${formatBytes(f.size, 'en-US')}`,
  }
  if (opts.allowExcerpt && meta.textExcerpt)
    input.textExcerpt = meta.textExcerpt.slice(0, settings.scan.maxTextExcerptChars)
  if (opts.allowImage && meta.thumbPath && settings.images.analyzeWithAI) {
    try {
      input.imageJpegBase64 = (await fs.readFile(meta.thumbPath)).toString('base64')
    } catch {
      /* thumbnail missing: send metadata only */
    }
  }
  return input
}

/**
 * Hard privacy gate (golden rule 6): a cloud provider never receives a sensitive file — not
 * its name, not its metadata. Local providers (LM Studio) may analyse them.
 */
export function gateForProvider<T extends { sensitive: boolean }>(
  files: T[],
  isCloud: boolean,
): T[] {
  return isCloud ? files.filter((f) => !f.sensitive) : files
}

/** Renders one user-message text block for a batch. */
export function renderBatchText(batch: AIClassifyInput[]): string {
  return batch
    .map((f) =>
      [
        `id: ${f.id}`,
        `name: ${f.name}   ext: ${f.ext || '-'}   size: ${formatBytes(f.sizeBytes, 'en-US')}   modified: ${f.mtimeIso}`,
        `kind: ${f.kind}`,
        `meta: ${f.metaSummary}`,
        f.textExcerpt ? `excerpt: ${f.textExcerpt.replace(/\s+/g, ' ')}` : '',
        f.imageJpegBase64 ? '[thumbnail attached]' : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')
}

const outputSchema = z.object({
  id: z.string(),
  category: z.string(),
  subcategory: z.string().max(80).optional(),
  suggested_name: z.string().max(120).optional(),
  date_hint: z.string().optional(),
  confidence: z.number().min(0).max(1),
  sensitive: z.boolean(),
  reason: z.string().max(400),
})

/** Normalises a category the model returned to the closed list (local models drift). */
export function normalizeCategory(raw: string, categories: Category[]): string {
  const ids = categories.filter((c) => c.enabled).map((c) => c.id)
  if (ids.includes(raw)) return raw
  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const byKey = ids.find((id) => id === key)
  if (byKey) return byKey
  const byName = categories.find(
    (c) =>
      c.nameTr.toLowerCase() === raw.toLowerCase() || c.nameEn.toLowerCase() === raw.toLowerCase(),
  )
  if (byName) return byName.id
  // "Fatura" → "Belgeler / Fatura & Makbuz" when exactly one category name contains it.
  const low = raw.toLocaleLowerCase('tr-TR').trim()
  if (low.length >= 4) {
    const partial = categories.filter(
      (c) =>
        c.enabled &&
        (c.nameTr.toLocaleLowerCase('tr-TR').includes(low) || c.nameEn.toLowerCase().includes(low)),
    )
    if (partial.length === 1) return partial[0]!.id
  }
  // Closest by bigram similarity; below 0.5 → uncertain.
  const grams = (s: string): Set<string> => {
    const g = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2))
    return g
  }
  const a = grams(key)
  let best = 'uncertain'
  let score = 0
  for (const id of ids) {
    const b = grams(id)
    const inter = [...a].filter((x) => b.has(x)).length
    const s = (2 * inter) / (a.size + b.size || 1)
    if (s > score) {
      score = s
      best = id
    }
  }
  return score >= 0.5 ? best : 'uncertain'
}

/**
 * Validates the provider's raw `results` array: keeps entries for known ids only, one per id,
 * maps aliases back. Missing ids are simply absent (those files fall back to rules).
 */
export function parseResults(
  raw: unknown,
  aliases: Set<string>,
  categories: Category[],
): AIClassifyOutput[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { results?: unknown }).results)
      ? (raw as { results: unknown[] }).results
      : []
  const seen = new Set<string>()
  const out: AIClassifyOutput[] = []
  for (const r of arr) {
    const p = outputSchema.safeParse(r)
    if (!p.success || !aliases.has(p.data.id) || seen.has(p.data.id)) continue
    seen.add(p.data.id)
    const d = p.data
    out.push({
      id: d.id,
      category: normalizeCategory(d.category, categories),
      subcategory: d.subcategory,
      suggestedName: d.suggested_name?.slice(0, 60),
      dateHint: d.date_hint && /^\d{4}(-\d{2})?$/.test(d.date_hint) ? d.date_hint : undefined,
      confidence: d.confidence,
      sensitive: d.sensitive,
      reason: d.reason.slice(0, 160),
    })
  }
  return out
}
