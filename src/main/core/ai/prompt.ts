import { createHash } from 'node:crypto'
import type { Category } from '@shared/types'
import type { Correction } from '../../db/repos'
import systemMd from '../../../../docs/prompts/classify-system.md?raw'
import schemaJson from '../../../../docs/prompts/classify-schema.json'

/** Bumped in docs/prompts/classify-system.md; part of every AI cache key (docs/03 §8). */
export const PROMPT_VERSION = Number(/PROMPT_VERSION:\s*(\d+)/.exec(systemMd)?.[1] ?? '1')

export const CLASSIFY_TOOL = schemaJson as {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** The template body after the "---" separator (the header is for humans). */
const TEMPLATE = systemMd
  .split(/\n---\n/)
  .slice(1)
  .join('\n---\n')
  .trim()

export function renderCategories(categories: Category[]): string {
  return categories
    .filter((c) => c.enabled)
    .map(
      (c) =>
        `- \`${c.id}\` — ${c.nameTr} / ${c.nameEn} — ${c.description}${c.examples.length ? ` (örn. ${c.examples.join(', ')})` : ''}`,
    )
    .join('\n')
}

export function renderExamples(corrections: Correction[]): string {
  if (!corrections.length) return '(none yet)'
  return corrections
    .slice(0, 20)
    .map(
      (c) =>
        `- .${c.ext} files named like "${c.namePattern}": not \`${c.oldCategory}\` but \`${c.newCategory}\``,
    )
    .join('\n')
}

export function systemPrompt(categories: Category[], corrections: Correction[]): string {
  return TEMPLATE.replace('{{CATEGORIES}}', renderCategories(categories)).replace(
    '{{EXAMPLES}}',
    renderExamples(corrections),
  )
}

/** Taxonomy fingerprint: changing categories invalidates cached AI results. */
export function taxonomyHash(categories: Category[]): string {
  const stable = categories
    .filter((c) => c.enabled)
    .map((c) => [c.id, c.description, c.examples])
    .sort()
  return createHash('sha1').update(JSON.stringify(stable)).digest('hex').slice(0, 12)
}
