import path from 'node:path'
import type { Category, FileMeta, Plan, PlanItem } from '@shared/types'

/** Report export (docs/01 §4.3). Excerpts/thumbnails are excluded unless `includeExcerpts`. */
export interface ExportOptions {
  categories: Category[]
  metas?: Map<string, FileMeta>
  includeExcerpts?: boolean
  lang?: 'tr' | 'en'
}

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

const ACTION_TR: Record<string, string> = {
  move: 'Taşı',
  rename: 'Yeniden adlandır',
  move_rename: 'Taşı + adlandır',
  quarantine: 'Karantina',
  trash: 'Çöp',
  skip: 'Atla',
  mkdir: 'Klasör',
}

function groups(plan: Plan): Map<string, PlanItem[]> {
  const g = new Map<string, PlanItem[]>()
  for (const it of plan.items) g.set(it.groupKey, [...(g.get(it.groupKey) ?? []), it])
  return g
}

function groupTitle(key: string): string {
  if (key === '__dupes') return 'Kopyalar → Karantina'
  if (key === '__near') return 'Benzer görseller'
  if (key === '__cloud') return 'Bulutta (indirilmemiş)'
  if (key === '__inplace') return 'Zaten yerinde'
  if (key === '__skip') return 'Dokunulmayanlar'
  const [root, rel] = key.split('|')
  return `${path.basename(root ?? '')} / ${rel ?? ''}`
}

const catName = (cats: Category[], id: string): string =>
  cats.find((c) => c.id === id)?.nameTr ?? id

export function exportJson(plan: Plan): string {
  return JSON.stringify(plan, null, 2)
}

export function exportMarkdown(plan: Plan, o: ExportOptions): string {
  const s = plan.summary
  const lines = [
    `# Döndü planı`,
    '',
    `- Oluşturuldu: ${new Date(plan.createdAt).toLocaleString('tr-TR')}`,
    `- Durum: ${plan.status}`,
    `- Kökler: ${plan.roots.join(', ')}`,
    `- Taşınacak: ${s.move} · Yeniden adlandırılacak: ${s.rename} · Karantina: ${s.quarantine} · Atlanacak: ${s.skip} · Hassas: ${s.sensitive}`,
    '',
    '> Döndü hiçbir dosyayı silmez. Kopyalar *Döndü Karantina* klasörüne gider; her şey Geçmiş’ten geri alınabilir.',
    '',
  ]
  for (const [key, items] of groups(plan)) {
    lines.push(`## ${groupTitle(key)} (${items.length})`, '')
    lines.push(
      '| Eylem | Dosya | Hedef | Kategori | Güven | Gerekçe |',
      '|---|---|---|---|---|---|',
    )
    for (const it of items) {
      const act = it.enabled ? ACTION_TR[it.action] : 'Atla'
      const row = [
        act,
        path.basename(it.sourcePath),
        it.action === 'skip'
          ? '—'
          : path.relative(path.dirname(path.dirname(it.sourcePath)), it.targetPath),
        catName(o.categories, it.category),
        `${Math.round(it.confidence * 100)}%`,
        it.reason,
      ].map((c) => String(c).replace(/\|/g, '\\|'))
      lines.push(`| ${row.join(' | ')} |`)
      if (o.includeExcerpts && !it.flags.includes('sensitive')) {
        const ex = o.metas?.get(it.fileId)?.textExcerpt
        if (ex)
          lines.push(
            `|  | > ${ex.slice(0, 200).replace(/\s+/g, ' ').replace(/\|/g, '\\|')} | | | | |`,
          )
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function exportHtml(plan: Plan, o: ExportOptions): string {
  const s = plan.summary
  const rows: string[] = []
  for (const [key, items] of groups(plan)) {
    rows.push(
      `<h2>${esc(groupTitle(key))} <small>${items.length}</small></h2><table><thead><tr><th>Eylem</th><th>Dosya</th><th>Hedef</th><th>Kategori</th><th>Güven</th><th>Gerekçe</th></tr></thead><tbody>`,
    )
    for (const it of items) {
      const ex =
        o.includeExcerpts && !it.flags.includes('sensitive')
          ? o.metas?.get(it.fileId)?.textExcerpt
          : undefined
      rows.push(
        `<tr class="${it.enabled ? '' : 'off'}"><td>${esc(it.enabled ? ACTION_TR[it.action]! : 'Atla')}</td><td title="${esc(it.sourcePath)}">${esc(path.basename(it.sourcePath))}${ex ? `<div class="ex">${esc(ex.slice(0, 300))}</div>` : ''}</td><td class="mono" title="${esc(it.targetPath)}">${esc(it.action === 'skip' ? '—' : it.targetPath)}</td><td>${esc(catName(o.categories, it.category))}</td><td>${Math.round(it.confidence * 100)}%</td><td>${esc(it.reason)}</td></tr>`,
      )
    }
    rows.push('</tbody></table>')
  }
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Döndü planı</title><style>
:root{--bg:#f6f7fa;--fg:#1a1f3a;--mut:#5f6478;--line:#e3e5ec;--acc:#3d5afe}
@media (prefers-color-scheme:dark){:root{--bg:#12141f;--fg:#eceef5;--mut:#9a9eb2;--line:#2a2e40;--acc:#5b74ff}}
body{font:14px/1.45 -apple-system,"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--fg);max-width:1200px;margin:32px auto;padding:0 24px}
h1{font-size:28px;margin:0 0 8px}h2{font-size:17px;margin:32px 0 8px}small{color:var(--mut);font-weight:400}
.sum{display:flex;gap:24px;flex-wrap:wrap;color:var(--mut)}.sum b{color:var(--fg);font-size:20px;display:block}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:500}.mono{font-family:ui-monospace,"SF Mono",Consolas,monospace;font-size:12px;word-break:break-all}
tr.off{opacity:.5}.ex{color:var(--mut);font-size:12px;margin-top:4px}.note{border-left:3px solid var(--acc);padding:8px 12px;margin:16px 0}
</style></head><body><h1>Döndü planı</h1><p>${esc(new Date(plan.createdAt).toLocaleString('tr-TR'))} · ${esc(plan.roots.join(', '))}</p>
<div class="sum"><div><b>${s.move}</b>taşıma</div><div><b>${s.rename}</b>yeniden adlandırma</div><div><b>${s.quarantine}</b>karantina</div><div><b>${s.skip}</b>atlanacak</div><div><b>${s.sensitive}</b>hassas</div></div>
<p class="note">Döndü hiçbir dosyayı silmez. Kopyalar <i>Döndü Karantina</i> klasörüne gider; her şey Geçmiş’ten geri alınabilir.</p>
${rows.join('\n')}</body></html>`
}
