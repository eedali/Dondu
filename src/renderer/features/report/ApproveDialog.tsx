import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Plan, PreflightResult } from '@shared/types'
import { api, shortPath } from '../../app/api'
import { useApp } from '../../app/store'
import { Button, Dialog, Notice } from '../../components/ui'

type Step = 'confirm' | 'double' | 'checking' | 'issues'

/**
 * "Uygulansın mı?" (docs/08 §4.6): counts, the no-delete promise, quarantine path. Over the
 * threshold a second "Yes, N files" step. Then approve → pre-flight → apply.
 */
export function ApproveDialog({
  open,
  plan,
  onClose,
}: {
  open: boolean
  plan: Plan
  onClose: () => void
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const threshold = useApp((s) => s.settings?.apply.doubleConfirmAbove ?? 500)
  const qName = useApp((s) => s.settings?.quarantineFolderName ?? 'Döndü Karantina')
  const [step, setStep] = useState<Step>('confirm')
  const [pre, setPre] = useState<PreflightResult | null>(null)
  const [busy, setBusy] = useState(false)
  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US'
  const s = plan.summary
  const count = s.total - s.skip

  useEffect(() => {
    if (open) {
      setStep('confirm')
      setPre(null)
    }
  }, [open])

  if (!open) return null

  const start = async (skipItemIds: string[] = []): Promise<void> => {
    setBusy(true)
    try {
      await api.invoke('apply:start', plan.id, { skipItemIds })
      useApp.setState({ route: 'apply', applyProgress: null })
      onClose()
    } catch (e) {
      useApp.getState().setError(e)
    } finally {
      setBusy(false)
    }
  }

  const approveAndCheck = async (): Promise<void> => {
    setBusy(true)
    setStep('checking')
    try {
      let current = plan
      if (plan.status === 'draft') {
        current = await api.invoke('plan:approve', plan.id)
        useApp.setState({ plan: current })
      }
      const res = await api.invoke('plan:preflight', current.id)
      setPre(res)
      if (res.ok) await start()
      else setStep('issues')
    } catch (e) {
      useApp.getState().setError(e)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const onApply = (): void => {
    if (step === 'confirm' && count > threshold) setStep('double')
    else void approveAndCheck()
  }

  const quarantinePath = `${plan.roots.length === 1 ? shortPath(plan.roots[0]!, 40) : '…'}${
    plan.roots[0]?.includes('\\') ? '\\' : '/'
  }${qName}`

  return (
    <Dialog
      open={open}
      title={step === 'issues' ? t('approve.issuesTitle') : t('approve.title')}
      onClose={busy ? () => undefined : onClose}
      width={520}
      footer={
        step === 'issues' && pre ? (
          <>
            <Button onClick={onClose}>{t('approve.stop')}</Button>
            <Button
              variant="primary"
              disabled={busy || pre.runnable === 0}
              onClick={() => void start(pre.issues.map((i) => i.itemId).filter(Boolean))}
            >
              {t('approve.skipAndContinue', { count: pre.runnable })}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={onApply} disabled={busy || step === 'checking'}>
              {step === 'double'
                ? t('approve.yesN', { count: count.toLocaleString(locale) as unknown as number })
                : t('approve.apply')}
            </Button>
          </>
        )
      }
    >
      {step === 'issues' && pre ? (
        <div className="flex flex-col gap-3">
          <p>{t('approve.issuesBody', { count: pre.issues.length })}</p>
          <ul className="max-h-60 overflow-auto rounded bg-surface-2 px-3 py-2 text-[13px]">
            {pre.issues.map((i, n) => (
              <li key={n} className="flex justify-between gap-3 py-0.5">
                <span className="truncate font-mono text-[12px]" title={i.path}>
                  {shortPath(i.path, 52)}
                </span>
                <span className="shrink-0 text-muted">{t(`approve.issue.${i.kind}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[17px]">
            {t('approve.counts', {
              move: s.move,
              rename: s.rename,
              quarantine: s.quarantine,
              skip: s.skip,
            })}
          </p>
          <Notice tone="accent">{t('approve.promise')}</Notice>
          <p className="text-[13px] text-muted">
            {t('approve.quarantine')} <span className="font-mono">{quarantinePath}</span>
          </p>
          {s.trash > 0 && <Notice tone="warn">{t('approve.trashWarn', { count: s.trash })}</Notice>}
          {step === 'double' && <Notice tone="warn">{t('approve.double', { count })}</Notice>}
          {step === 'checking' && <p className="text-[13px] text-muted">{t('approve.checking')}</p>}
        </div>
      )}
    </Dialog>
  )
}
