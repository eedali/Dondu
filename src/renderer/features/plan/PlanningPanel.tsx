import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../app/api'
import { useApp } from '../../app/store'
import { Button, Progress, ProgressIndeterminate } from '../../components/ui'

function fmt(ms: number, lang: string): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (lang === 'tr') return m ? `${m} dk ${r} sn` : `${r} sn`
  return m ? `${m} min ${r} s` : `${r} s`
}

/**
 * Shown on every screen while a plan is being built (it runs in the background).
 * "Durdur" offers: build with what we have so far, or give up entirely.
 */
export function PlanningPanel(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const planning = useApp((s) => s.planning)
  const p = useApp((s) => s.planProgress)
  const [now, setNow] = useState(Date.now())
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    if (!planning) {
      setAsking(false)
      return
    }
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [planning])

  if (!planning) return null
  const startedAt = p?.startedAt ?? now
  const elapsed = now - startedAt
  const hasCount = !!p && p.total > 0 && (p.phase === 'ai' || p.phase === 'organize')
  const remaining = hasCount && p.done > 0 ? (elapsed / p.done) * (p.total - p.done) : undefined
  const stopping = !!p?.stopping

  const stop = (mode: 'partial' | 'abort'): void => {
    setAsking(false)
    void api.invoke('plan:cancel', mode)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 right-6 z-40 w-[380px] rounded-lg border border-line bg-surface px-5 py-4 shadow-lg"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">
          {stopping ? t('planning.stopping') : t('planning.title')}
        </span>
        {hasCount && (
          <span className="text-[13px] tabular-nums text-muted">
            {p.done} / {p.total}
          </span>
        )}
      </div>
      <div className="mt-1 text-[13px] text-muted">
        {t(`planning.phase.${p?.phase ?? 'rules'}`, { done: p?.done ?? 0, total: p?.total ?? 0 })}
      </div>
      <div className="mt-3">
        {hasCount ? (
          <Progress value={p.done} max={p.total} label={t('planning.title')} />
        ) : (
          <ProgressIndeterminate label={t('planning.title')} />
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 text-[12px] text-muted">
        <span>{t('apply.elapsed', { time: fmt(elapsed, i18n.language) })}</span>
        {remaining !== undefined && (
          <span>{t('apply.remaining', { time: fmt(remaining, i18n.language) })}</span>
        )}
        {(p?.usd ?? 0) > 0 && <span>{t('planning.spent', { usd: (p?.usd ?? 0).toFixed(4) })}</span>}
      </div>

      {!stopping &&
        (asking ? (
          <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
            <p className="text-[13px]">{t('planning.askStop')}</p>
            <Button size="sm" variant="primary" onClick={() => stop('partial')}>
              {t('planning.buildPartial')}
            </Button>
            <Button size="sm" onClick={() => stop('abort')}>
              {t('planning.abort')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
              {t('planning.keepGoing')}
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={() => setAsking(true)}>
              {t('planning.stop')}
            </Button>
          </div>
        ))}
    </div>
  )
}
