import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Layout } from '../../app/Layout'
import { api, shortPath } from '../../app/api'
import { useApp } from '../../app/store'
import { Button, Card, Notice, Progress } from '../../components/ui'

function fmtDuration(ms: number, lang: string): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (lang === 'tr') return m ? `${m} dk ${r} sn` : `${r} sn`
  return m ? `${m} min ${r} s` : `${r} s`
}

/** Apply progress (docs/08 §4.7): bar, current file, elapsed/remaining, errors, pause/stop. */
export function ApplyScreen(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const p = useApp((s) => s.applyProgress)
  const setRoute = useApp((s) => s.setRoute)
  const loadPlan = useApp((s) => s.loadPlan)
  const started = useRef(Date.now())
  const [now, setNow] = useState(Date.now())
  const [undoing, setUndoing] = useState(false)
  const [undoMsg, setUndoMsg] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const running = !p || p.status === 'running' || p.status === 'paused'
  const finished = p && !running
  useEffect(() => {
    if (p && !running) void loadPlan()
  }, [p, running, loadPlan])

  const elapsed = now - started.current
  const remaining = p && p.done > 0 ? (elapsed / p.done) * (p.total - p.done) : undefined

  return (
    <Layout
      title={
        finished ? t('nav.apply') : p?.kind === 'undo' ? t('apply.undoTitle') : t('apply.title')
      }
      action={
        running && p ? (
          <div className="flex gap-2">
            {p.status === 'paused' && !p.waiting ? (
              <Button onClick={() => void api.invoke('apply:resume')}>{t('apply.resume')}</Button>
            ) : !p.waiting ? (
              <Button onClick={() => void api.invoke('apply:pause')}>{t('apply.pause')}</Button>
            ) : null}
            <Button variant="danger" onClick={() => void api.invoke('apply:cancel')}>
              {t('apply.stop')}
            </Button>
          </div>
        ) : null
      }
    >
      <Card className="px-6 py-6">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="text-[17px] font-medium">
            {!p
              ? t('apply.starting')
              : finished
                ? t(`apply.status.${p.status}`)
                : p.status === 'paused'
                  ? t('apply.paused')
                  : t('apply.working')}
          </div>
          <div className="text-[13px] tabular-nums text-muted">
            {p ? `${p.done} / ${p.total}` : ''}
          </div>
        </div>
        <Progress value={p?.done ?? 0} max={p?.total || 1} label={t('apply.title')} />
        <div className="mt-3 h-5 truncate font-mono text-[13px] text-muted">
          {running && p?.currentItem ? shortPath(p.currentItem, 90) : ''}
        </div>
        {running && (
          <div className="mt-2 flex gap-8 text-[13px] text-muted">
            <span>{t('apply.elapsed', { time: fmtDuration(elapsed, i18n.language) })}</span>
            {remaining !== undefined && (
              <span>{t('apply.remaining', { time: fmtDuration(remaining, i18n.language) })}</span>
            )}
          </div>
        )}
      </Card>

      {p?.waiting && (
        <div className="mt-4">
          <Notice tone="error">
            <div className="font-medium">{t('apply.errorStopped')}</div>
            <div className="mt-1 font-mono text-[12px]">
              {shortPath(p.errors.at(-1)?.path ?? '', 80)}
            </div>
            <div className="mt-1">{p.errors.at(-1)?.message}</div>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => void api.invoke('apply:resume', { skipFailed: true })}
              >
                {t('apply.skipContinue')}
              </Button>
              <Button size="sm" onClick={() => void api.invoke('apply:cancel')}>
                {t('apply.stop')}
              </Button>
            </div>
          </Notice>
        </div>
      )}

      {p && p.errors.length > 0 && !p.waiting && (
        <Card className="mt-4 px-6 py-4">
          <h2 className="mb-2 font-medium">{t('apply.errors', { count: p.errors.length })}</h2>
          <ul className="max-h-48 overflow-auto text-[13px]">
            {p.errors.map((e, i) => (
              <li key={i} className="flex justify-between gap-3 py-0.5">
                <span className="truncate font-mono text-[12px]">{shortPath(e.path, 60)}</span>
                <span className="shrink-0 text-muted">{e.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {finished && p && (
        <div className="mt-4 flex flex-col gap-3">
          <Notice tone="accent">
            {p.kind === 'apply'
              ? t('apply.doneMsg', { done: p.done - p.errors.length, failed: p.errors.length })
              : t('apply.undoDoneMsg', { done: p.done })}
          </Notice>
          {undoMsg && <Notice>{undoMsg}</Notice>}
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => setRoute('history')}>
              {t('apply.seeHistory')}
            </Button>
            {p.kind === 'apply' && (
              <Button
                disabled={undoing}
                onClick={() => {
                  setUndoing(true)
                  void api
                    .invoke('undo:run', p.runId)
                    .then((r) =>
                      setUndoMsg(
                        r.changed.length
                          ? t('history.changedWarn', { count: r.changed.length })
                          : t('history.undone', { count: r.undone }),
                      ),
                    )
                    .catch((e) => useApp.getState().setError(e))
                    .finally(() => setUndoing(false))
                }}
              >
                {t('apply.undo')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Layout>
  )
}
