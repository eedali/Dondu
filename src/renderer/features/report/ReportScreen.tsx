import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { categoryName } from '@shared/categories'
import { formatBytes } from '@shared/format'
import type { Plan, PlanItem } from '@shared/types'
import { Layout } from '../../app/Layout'
import { StatusLine } from '../../app/StatusLine'
import { useApp } from '../../app/store'
import { Button, EmptyState, Input, Notice, Select, Tabs, cx } from '../../components/ui'
import { ApproveDialog } from './ApproveDialog'
import { DetailPanel } from './DetailPanel'
import { FolderDialog } from './FolderDialog'
import { ItemRow } from './ItemRow'
import { duplicateForEditing, exportReport, patchItems } from './actions'
import { groupItems, groupLabel, tabItems, type ReportTab } from './model'

const PAGE = 150

export function ReportScreen(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const plan = useApp((s) => s.plan)
  const setRoute = useApp((s) => s.setRoute)
  const [tab, setTab] = useState<ReportTab>('plan')
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('')
  const [conf, setConf] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [approveOpen, setApproveOpen] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)

  if (!plan) {
    return (
      <Layout title={t('report.title')}>
        <EmptyState
          title={t('report.emptyTitle')}
          body={t('report.emptyBody')}
          action={<Button onClick={() => setRoute('scan')}>{t('nav.scan')}</Button>}
        />
      </Layout>
    )
  }

  const editable = plan.status === 'draft'
  const sel = plan.items.find((i) => i.id === selected) ?? null
  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US'

  return (
    <Layout
      title={t('report.title')}
      wide
      action={
        <div className="flex items-center gap-2">
          {exportMsg && <span className="text-[13px] text-muted">{exportMsg}</span>}
          <Select
            aria-label={t('report.export')}
            value=""
            onChange={(e) => {
              const f = e.target.value as 'html' | 'md' | 'json'
              if (f) void exportReport(f).then((p) => p && setExportMsg(t('report.exported')))
            }}
            options={[
              { value: '', label: t('report.export') },
              { value: 'html', label: 'HTML' },
              { value: 'md', label: 'Markdown' },
              { value: 'json', label: 'JSON' },
            ]}
          />
        </div>
      }
      footer={
        <>
          <StatusLine />
          <div className="flex gap-2">
            {editable ? (
              <Button
                variant="primary"
                disabled={plan.summary.total - plan.summary.skip === 0}
                onClick={() => setApproveOpen(true)}
              >
                {t('report.approve')}
              </Button>
            ) : plan.status === 'approved' ? (
              <Button variant="primary" onClick={() => setApproveOpen(true)}>
                {t('report.applyApproved')}
              </Button>
            ) : (
              <>
                <Button onClick={() => void duplicateForEditing()}>{t('report.copyToEdit')}</Button>
                <Button variant="primary" onClick={() => setRoute('history')}>
                  {t('report.seeHistory')}
                </Button>
              </>
            )}
          </div>
        </>
      }
    >
      <SummaryStrip plan={plan} locale={locale} onPick={setTab} />
      {!editable && (
        <div className="mb-4">
          <Notice tone="accent">{t(`report.locked.${plan.status}`)}</Notice>
        </div>
      )}
      {plan.summary.ai && (
        <p className="mb-3 text-[13px] text-muted">
          {t('report.aiUsed', {
            files: plan.summary.ai.files,
            tin: plan.summary.ai.tokensIn.toLocaleString(locale),
            tout: plan.summary.ai.tokensOut.toLocaleString(locale),
            usd: plan.summary.ai.usd.toFixed(4),
          })}
          {plan.summary.ai.failedBatches > 0 ? ` ${t('report.aiFailed')}` : ''}
        </p>
      )}

      <Tabs
        label={t('report.title')}
        value={tab}
        onChange={setTab}
        tabs={(['plan', 'review', 'dupes', 'sensitive', 'skipped'] as ReportTab[]).map((id) => ({
          id,
          label: t(`report.tab.${id}`),
          count: tabItems(plan, id).length,
        }))}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder={t('report.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-64"
          aria-label={t('report.search')}
        />
        <Select
          aria-label={t('report.category')}
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          options={[
            { value: '', label: t('report.allCategories') },
            ...[...new Set(plan.items.map((i) => i.category))].map((c) => ({
              value: c,
              label: categoryName(useApp.getState().categories, c, i18n.language),
            })),
          ]}
        />
        <Select
          aria-label={t('report.confidence')}
          value={conf}
          onChange={(e) => setConf(e.target.value)}
          options={[
            { value: '', label: t('report.allConfidence') },
            { value: 'high', label: t('report.confHigh') },
            { value: 'mid', label: t('report.confMid') },
            { value: 'low', label: t('report.confLow') },
          ]}
        />
      </div>

      <div className="mt-4 flex gap-4">
        <div className="min-w-0 flex-1">
          <GroupList
            plan={plan}
            tab={tab}
            query={query}
            cat={cat}
            conf={conf}
            editable={editable}
            selected={selected}
            onSelect={setSelected}
          />
        </div>
        {sel && (
          <DetailPanel
            plan={plan}
            item={sel}
            editable={editable}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      <ApproveDialog open={approveOpen} plan={plan} onClose={() => setApproveOpen(false)} />
    </Layout>
  )
}

function SummaryStrip({
  plan,
  locale,
  onPick,
}: {
  plan: Plan
  locale: string
  onPick: (t: ReportTab) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const s = plan.summary
  const cells: { k: string; v: number; tab: ReportTab }[] = [
    { k: 'move', v: s.move, tab: 'plan' },
    { k: 'rename', v: s.rename, tab: 'plan' },
    { k: 'quarantine', v: s.quarantine, tab: 'dupes' },
    { k: 'skip', v: s.skip, tab: 'skipped' },
    { k: 'sensitive', v: s.sensitive, tab: 'sensitive' },
  ]
  return (
    <div className="mb-5 grid grid-cols-5 gap-2">
      {cells.map((c) => (
        <button
          key={c.k}
          type="button"
          onClick={() => onPick(c.tab)}
          className="rounded-lg border border-line bg-surface px-4 py-3 text-left hover:bg-surface-2"
        >
          <div className="text-[22px] font-semibold tabular-nums">{c.v.toLocaleString(locale)}</div>
          <div className="text-[13px] text-muted">{t(`report.sum.${c.k}`)}</div>
        </button>
      ))}
      <div className="col-span-5 text-[13px] text-muted">
        {t('report.bytes', { size: formatBytes(s.bytes, locale) })}
      </div>
    </div>
  )
}

function matches(it: PlanItem, q: string, cat: string, conf: string): boolean {
  if (cat && it.category !== cat) return false
  if (conf === 'high' && it.confidence < 0.85) return false
  if (conf === 'mid' && (it.confidence < 0.6 || it.confidence >= 0.85)) return false
  if (conf === 'low' && it.confidence >= 0.6) return false
  if (q) {
    const s = q.toLocaleLowerCase('tr-TR')
    if (
      !it.sourcePath.toLocaleLowerCase('tr-TR').includes(s) &&
      !it.targetPath.toLocaleLowerCase('tr-TR').includes(s)
    )
      return false
  }
  return true
}

function GroupList(props: {
  plan: Plan
  tab: ReportTab
  query: string
  cat: string
  conf: string
  editable: boolean
  selected: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { plan, tab, query, cat, conf } = props
  const groups = useMemo(
    () => groupItems(tabItems(plan, tab).filter((it) => matches(it, query, cat, conf))),
    [plan, tab, query, cat, conf],
  )
  if (!groups.length) return <EmptyState title={t('report.noItems')} />
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <GroupSection key={g.key} groupKey={g.key} items={g.items} {...props} />
      ))}
    </div>
  )
}

function GroupSection({
  groupKey,
  items,
  plan,
  editable,
  selected,
  onSelect,
}: {
  groupKey: string
  items: PlanItem[]
  plan: Plan
  editable: boolean
  selected: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const [limit, setLimit] = useState(PAGE)
  const [folderOpen, setFolderOpen] = useState(false)
  const label = groupLabel(groupKey)
  const allOn = items.every((i) => i.enabled)
  const canMove = editable && !label.special
  return (
    <section className="rounded-lg border border-line bg-surface">
      <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className={cx('text-muted transition-transform', open ? 'rotate-90' : '')}
            aria-hidden
          >
            ›
          </span>
          {label.special ? (
            <span className="font-medium">{t(`report.group.${label.special}`)}</span>
          ) : (
            <span className="min-w-0 truncate">
              <span className="text-muted">{label.root} / </span>
              <span className="font-medium">{label.rel || t('report.rootLevel')}</span>
            </span>
          )}
          <span className="shrink-0 text-[13px] text-muted">
            {t('common.files', { count: items.length })}
          </span>
        </button>
        {editable && (
          <div className="flex shrink-0 gap-1">
            {canMove && (
              <Button size="sm" variant="ghost" onClick={() => setFolderOpen(true)}>
                {t('report.changeTarget')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void patchItems(
                  items.filter((i) => i.action !== 'skip').map((i) => i.id),
                  { enabled: !allOn },
                )
              }
            >
              {allOn ? t('report.skipAll') : t('report.includeAll')}
            </Button>
          </div>
        )}
      </header>
      {open && (
        <ul>
          {items.slice(0, limit).map((it) => (
            <ItemRow
              key={it.id}
              plan={plan}
              item={it}
              editable={editable}
              selected={selected === it.id}
              onSelect={() => onSelect(it.id)}
            />
          ))}
          {items.length > limit && (
            <li className="px-4 py-2">
              <Button size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE)}>
                {t('report.showMore', { count: items.length - limit })}
              </Button>
            </li>
          )}
        </ul>
      )}
      {folderOpen && (
        <FolderDialog
          plan={plan}
          items={items}
          initialRel={label.rel.split(' / ').join('/')}
          onClose={() => setFolderOpen(false)}
        />
      )}
    </section>
  )
}
