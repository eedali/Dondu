import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { presetFor } from '@shared/models'
import type { AIEstimate } from '@shared/types'
import { api } from '../../app/api'
import { useApp } from '../../app/store'
import { Button, Dialog, Notice } from '../../components/ui'

/** AI cost estimate before planning (docs/08 §4.4). Over the limit → AI button disabled. */
export function EstimateDialog({
  open,
  sessionId,
  onClose,
  onRun,
}: {
  open: boolean
  sessionId: string
  onClose: () => void
  onRun: (useAI: boolean) => void
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const settings = useApp((s) => s.settings)
  const setRoute = useApp((s) => s.setRoute)
  const [est, setEst] = useState<AIEstimate | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setEst(null)
    setErr(null)
    api
      .invoke('ai:estimate', sessionId)
      .then(setEst)
      .catch((e: Error) => setErr(e.message))
  }, [open, sessionId])

  if (!open) return null
  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US'
  const usd = (n: number): string =>
    `$${n.toLocaleString(locale, { minimumFractionDigits: n < 0.1 ? 3 : 2, maximumFractionDigits: n < 0.1 ? 4 : 2 })}`
  const providerName = t(`ai.provider.${settings?.ai.provider ?? 'none'}`)

  return (
    <Dialog
      open={open}
      title={t('estimate.title')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => onRun(false)}>{t('estimate.rulesOnly')}</Button>
          <Button variant="primary" disabled={!est || est.overLimit} onClick={() => onRun(true)}>
            {t('estimate.run', { provider: providerName })}
          </Button>
        </>
      }
    >
      {err ? (
        <Notice tone="error">{err}</Notice>
      ) : !est ? (
        <p className="text-muted">{t('estimate.calculating')}</p>
      ) : est.files === 0 ? (
        <p>{t('estimate.nothing')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[17px]">
            {t('estimate.line', {
              files: est.files.toLocaleString(locale),
              tokens: Math.round(est.tokensIn + est.tokensOut).toLocaleString(locale),
              usd: est.provider === 'lmstudio' ? t('estimate.free') : usd(est.usd),
            })}
          </p>
          {est.model && est.provider === 'anthropic' && (
            <p className="text-[13px] text-muted">
              {t('estimate.model', { model: presetFor(est.model)?.name ?? est.model })}
            </p>
          )}
          {est.cachedFiles > 0 && (
            <p className="text-[13px] text-muted">
              {t('estimate.cached', { count: est.cachedFiles })}
            </p>
          )}
          {est.withImages > 0 && (
            <p className="text-[13px] text-muted">
              {t('estimate.images', { count: est.withImages })}
            </p>
          )}
          {est.overLimit && (
            <Notice tone="warn">
              <div>
                {t(est.limitReason === 'tokens' ? 'estimate.overTokens' : 'estimate.overUsd', {
                  limit:
                    est.limitReason === 'tokens'
                      ? settings?.ai.maxTokensPerRun.toLocaleString(locale)
                      : usd(settings?.ai.maxUsdPerRun ?? 0),
                })}
              </div>
              <div className="mt-1">{t('estimate.overHint')}</div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={() => setRoute('settings')}
              >
                {t('nav.settings')}
              </Button>
            </Notice>
          )}
          <p className="text-[13px] text-muted">{t('estimate.privacy')}</p>
        </div>
      )}
    </Dialog>
  )
}
