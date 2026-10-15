import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '@shared/format'
import type { QuarantineInfo, UndoResult } from '@shared/ipc'
import type { JournalRow, RunRecord } from '@shared/types'
import { Layout } from '../../app/Layout'
import { api, shortPath } from '../../app/api'
import { useApp } from '../../app/store'
import { Badge, Button, Card, Dialog, EmptyState, Input, Notice } from '../../components/ui'

export function HistoryScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const [runs, setRuns] = useState<RunRecord[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [quarantine, setQuarantine] = useState<QuarantineInfo[]>([])
  const applyProgress = useApp((s) => s.applyProgress)

  const reload = useCallback(async () => {
    setRuns(await api.invoke('history:list'))
    setQuarantine(await api.invoke('quarantine:list'))
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, applyProgress?.status])

  return (
    <Layout title={t('history.title')}>
      <QuarantineNotice items={quarantine} onChange={reload} />
      {!runs ? null : runs.length === 0 ? (
        <EmptyState title={t('history.emptyTitle')} body={t('history.emptyBody')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {runs.map((r) => (
            <li key={r.id}>
              <RunCard
                run={r}
                open={open === r.id}
                onToggle={() => setOpen(open === r.id ? null : r.id)}
                onChanged={reload}
              />
            </li>
          ))}
        </ul>
      )}
    </Layout>
  )
}

function RunCard({
  run,
  open,
  onToggle,
  onChanged,
}: {
  run: RunRecord
  open: boolean
  onToggle: () => void
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US'
  const [rows, setRows] = useState<JournalRow[] | null>(null)
  const [filter, setFilter] = useState('')
  const [result, setResult] = useState<UndoResult | null>(null)
  const [confirm, setConfirm] = useState<{ itemId?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) void api.invoke('history:journal', run.id).then(setRows)
  }, [open, run.id])

  const undoable = useMemo(
    () => (rows ?? []).some((r) => r.status === 'done' && r.op !== 'verify'),
    [rows],
  )

  const doUndo = async (itemId?: string, force = false): Promise<void> => {
    setBusy(true)
    try {
      const res = itemId
        ? await api.invoke('undo:item', run.id, itemId, { force })
        : await api.invoke('undo:run', run.id, { force })
      setResult(res)
      setRows(await api.invoke('history:journal', run.id))
      await onChanged()
      await useApp.getState().loadPlan()
    } catch (e) {
      useApp.getState().setError(e)
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const items = useMemo(() => {
    const m = new Map<string, JournalRow[]>()
    for (const r of rows ?? []) {
      if (r.op === 'mkdir' || r.op === 'rmdir_empty' || r.op === 'verify') continue
      const key = r.itemId ?? `row-${r.id}`
      m.set(key, [...(m.get(key) ?? []), r])
    }
    const f = filter.toLocaleLowerCase('tr-TR')
    return [...m.entries()].filter(
      ([, rs]) => !f || rs.some((r) => (r.src + r.dst).toLocaleLowerCase('tr-TR').includes(f)),
    )
  }, [rows, filter])

  const s = run.stats
  return (
    <Card>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">
              {run.kind === 'undo' ? t('history.kindUndo') : t('history.kindApply')}
            </span>
            <Badge
              tone={run.status === 'done' ? 'accent' : run.status === 'failed' ? 'error' : 'warn'}
            >
              {t(`apply.status.${run.status}`)}
            </Badge>
          </div>
          <div className="text-[13px] text-muted">
            {new Date(run.startedAt).toLocaleString(locale)} ·{' '}
            {run.roots.map((r) => r.split(/[\\/]/).pop()).join(', ')}
          </div>
        </div>
        <div className="shrink-0 text-right text-[13px] text-muted">
          <div>{t('history.counts', { done: s.done, skipped: s.skipped, failed: s.failed })}</div>
          {s.bytes > 0 && <div>{formatBytes(s.bytes, locale)}</div>}
          {run.ai && run.ai.tokensIn > 0 && (
            <div>
              {t('history.ai', {
                tin: run.ai.tokensIn.toLocaleString(locale),
                tout: run.ai.tokensOut.toLocaleString(locale),
                usd: run.ai.usd.toFixed(4),
              })}
            </div>
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-line px-5 py-4">
          {result && (
            <div className="mb-3 flex flex-col gap-2">
              <Notice tone="accent">{t('history.undone', { count: result.undone })}</Notice>
              {result.changed.length > 0 && (
                <Notice tone="warn">
                  <div>{t('history.changedWarn', { count: result.changed.length })}</div>
                  <Button size="sm" className="mt-2" onClick={() => setConfirm({})}>
                    {t('history.forceUndo')}
                  </Button>
                </Notice>
              )}
              {result.trashed.length > 0 && (
                <Notice tone="warn">
                  {t('history.trashed', { count: result.trashed.length })}
                  <ul className="mt-1 font-mono text-[12px]">
                    {result.trashed.slice(0, 10).map((p) => (
                      <li key={p}>{shortPath(p, 70)}</li>
                    ))}
                  </ul>
                </Notice>
              )}
            </div>
          )}
          <div className="mb-3 flex items-center gap-2">
            <Input
              type="search"
              placeholder={t('report.search')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-64"
              aria-label={t('report.search')}
            />
            <div className="flex-1" />
            {undoable && (
              <Button variant="primary" disabled={busy} onClick={() => void doUndo()}>
                {run.kind === 'undo' ? t('history.redo') : t('history.undoAll')}
              </Button>
            )}
          </div>
          {!rows ? null : (
            <table className="w-full text-[13px]">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 font-normal">{t('history.col.file')}</th>
                  <th className="py-1 font-normal">{t('history.col.where')}</th>
                  <th className="py-1 font-normal">{t('history.col.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 500).map(([key, rs]) => {
                  const main =
                    rs.find((r) => r.op === 'rename' || r.op === 'copy' || r.op === 'trash') ??
                    rs[0]!
                  const last = rs[rs.length - 1]!
                  const done = rs.some((r) => r.status === 'done')
                  const undone = rs.every((r) => r.status === 'undone' || r.status === 'skipped')
                  return (
                    <tr key={key} className="border-t border-line align-top">
                      <td className="max-w-[220px] truncate py-1.5 pr-2" title={main.src}>
                        {main.src.split(/[\\/]/).pop()}
                      </td>
                      <td
                        className="max-w-[320px] truncate py-1.5 pr-2 font-mono text-[12px] text-muted"
                        title={last.dst}
                      >
                        {last.dst ? shortPath(last.dst, 56) : t('history.osTrash')}
                      </td>
                      <td className="py-1.5 pr-2">
                        <Badge
                          tone={
                            rs.some((r) => r.status === 'failed')
                              ? 'error'
                              : undone
                                ? 'neutral'
                                : 'accent'
                          }
                        >
                          {t(
                            `history.rowStatus.${rs.some((r) => r.status === 'failed') ? 'failed' : undone ? (rs.some((r) => r.status === 'skipped') ? 'skipped' : 'undone') : 'done'}`,
                          )}
                        </Badge>
                      </td>
                      <td className="py-1.5 text-right">
                        {done && main.itemId && run.kind === 'apply' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void doUndo(main.itemId!)}
                          >
                            {t('history.undoOne')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
      <Dialog
        open={!!confirm}
        title={t('history.forceTitle')}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t('history.skipChanged')}</Button>
            <Button variant="primary" onClick={() => void doUndo(confirm?.itemId, true)}>
              {t('history.forceUndo')}
            </Button>
          </>
        }
      >
        <p>{t('history.forceBody', { count: result?.changed.length ?? 0 })}</p>
      </Dialog>
    </Card>
  )
}

function QuarantineNotice({
  items,
  onChange,
}: {
  items: QuarantineInfo[]
  onChange: () => Promise<void>
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const days = useApp((s) => s.settings?.history.quarantineReminderDays ?? 30)
  const [confirm, setConfirm] = useState<QuarantineInfo | null>(null)
  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US'
  if (!items.length) return null
  return (
    <div className="mb-5 flex flex-col gap-2">
      {items.map((q) => (
        <Notice key={q.path} tone={q.oldestDays >= days ? 'warn' : 'neutral'}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div>
                {q.oldestDays >= days
                  ? t('quarantine.reminder', {
                      days: q.oldestDays,
                      size: formatBytes(q.bytes, locale),
                    })
                  : t('quarantine.info', { size: formatBytes(q.bytes, locale) })}
              </div>
              <div className="font-mono text-[12px] text-muted">{shortPath(q.path, 70)}</div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void api.invoke('shell:reveal', q.path)}
              >
                {t('common.reveal')}
              </Button>
              <Button size="sm" onClick={() => setConfirm(q)}>
                {t('quarantine.empty')}
              </Button>
            </div>
          </div>
        </Notice>
      ))}
      <Dialog
        open={!!confirm}
        title={t('quarantine.confirmTitle')}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!confirm) return
                void api.invoke('quarantine:trash', confirm.path).then(async (r) => {
                  setConfirm(null)
                  if (!r.ok) useApp.getState().setError(r.message ?? 'trash_failed')
                  await onChange()
                })
              }}
            >
              {t('quarantine.toTrash')}
            </Button>
          </>
        }
      >
        <p>{t('quarantine.confirmBody')}</p>
      </Dialog>
    </div>
  )
}
