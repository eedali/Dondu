import type { Plan, PlanItem } from '@shared/types'

export type ReportTab = 'plan' | 'review' | 'dupes' | 'sensitive' | 'skipped'

export const isReview = (it: PlanItem): boolean =>
  it.flags.includes('low_confidence') || it.flags.includes('junk')
export const isDupe = (it: PlanItem): boolean =>
  it.flags.includes('duplicate') || it.flags.includes('near_duplicate')
export const isSensitive = (it: PlanItem): boolean =>
  it.flags.includes('sensitive') || !!it.sensitive
export const isSkipped = (it: PlanItem): boolean => it.action === 'skip' || !it.enabled

export function tabItems(plan: Plan, tab: ReportTab): PlanItem[] {
  switch (tab) {
    case 'plan':
      return plan.items.filter((it) => it.enabled && it.action !== 'skip')
    case 'review':
      return plan.items.filter((it) => isReview(it) && it.action !== 'skip')
    case 'dupes':
      return plan.items.filter(isDupe)
    case 'sensitive':
      return plan.items.filter(isSensitive)
    case 'skipped':
      return plan.items.filter(isSkipped)
  }
}

export interface Group {
  key: string
  items: PlanItem[]
}

export function groupItems(items: PlanItem[]): Group[] {
  const map = new Map<string, PlanItem[]>()
  for (const it of items) map.set(it.groupKey, [...(map.get(it.groupKey) ?? []), it])
  const special = ['__dupes', '__near', '__inplace', '__cloud', '__skip']
  return [...map.entries()]
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => {
      const sa = special.indexOf(a.key)
      const sb = special.indexOf(b.key)
      if (sa !== sb) return sa - sb
      return a.key.localeCompare(b.key, 'tr')
    })
}

/** "C:\…\Masaüstü|Belgeler/Fatura ve Makbuz/2024" → { root: "Masaüstü", rel: "Belgeler / Fatura ve Makbuz / 2024" } */
export function groupLabel(key: string): { root?: string; rel: string; special?: string } {
  if (key.startsWith('__')) return { rel: '', special: key.slice(2) }
  const [root = '', rel = ''] = key.split('|')
  return { root: root.split(/[\\/]/).filter(Boolean).pop(), rel: rel.split('/').join(' / ') }
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

/** Target shown relative to its root: "Belgeler/Fatura ve Makbuz/2024/x.pdf". */
export function relTarget(plan: Plan, it: PlanItem): string {
  const root = plan.roots.find((r) => it.targetPath.toLowerCase().startsWith(r.toLowerCase()))
  const rel = root ? it.targetPath.slice(root.length).replace(/^[\\/]/, '') : it.targetPath
  return rel.split(/[\\/]/).join('/')
}

export function rootOf(plan: Plan, p: string): string | undefined {
  return plan.roots.find((r) => p.toLowerCase().startsWith(r.toLowerCase()))
}

export interface TreeNode {
  /** groupKey-style id: "<root>|<rel>" */
  key: string
  root: string
  rel: string
  name: string
  depth: number
  /** Items directly in this folder plus in its sub-folders. */
  count: number
}

/** Target folders as a flat, depth-ordered tree (revision 1 report view). */
export function folderTree(items: PlanItem[]): TreeNode[] {
  const counts = new Map<string, { root: string; rel: string; count: number }>()
  for (const it of items) {
    if (it.groupKey.startsWith('__') || it.action === 'skip') continue
    const [root = '', rel = ''] = it.groupKey.split('|')
    const segs = rel.split('/').filter(Boolean)
    for (let i = 0; i <= segs.length; i++) {
      const r = segs.slice(0, i).join('/')
      const k = `${root}|${r}`
      const c = counts.get(k) ?? { root, rel: r, count: 0 }
      c.count++
      counts.set(k, c)
    }
  }
  return [...counts.entries()]
    .map(([key, c]) => ({
      key,
      root: c.root,
      rel: c.rel,
      name: c.rel
        ? c.rel.split('/').pop()!
        : (c.root.split(/[\/]/).filter(Boolean).pop() ?? c.root),
      depth: c.rel ? c.rel.split('/').length : 0,
      count: c.count,
    }))
    .sort((a, b) => (a.root + '|' + a.rel).localeCompare(b.root + '|' + b.rel, 'tr'))
}

/** Does this item go into `node` (or one of its sub-folders)? */
export function inFolder(it: PlanItem, node: { root: string; rel: string }): boolean {
  const [root = '', rel = ''] = it.groupKey.split('|')
  if (root !== node.root) return false
  return !node.rel || rel === node.rel || rel.startsWith(`${node.rel}/`)
}
