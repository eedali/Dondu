import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PendingRecovery } from '@shared/types'
import { api } from '../../app/api'
import { useApp } from '../../app/store'
import { Button, Dialog } from '../../components/ui'

/** "Yarım kalan işlem bulundu — Devam et / Geri al / İncele" (docs/05 §4). */
export function RecoveryDialog(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const [pending, setPending] = useState<PendingRecovery[]>([])
  const setRoute = useApp((s) => s.setRoute)

  useEffect(() => {
    void api.invoke('recovery:pending').then(setPending)
  }, [])

  const rec = pending[0]
  if (!rec) return null
  const resolve = async (action: 'complete' | 'undo' | 'ignore'): Promise<void> => {
    try {
      if (action !== 'ignore') useApp.setState({ route: 'apply', applyProgress: null })
      await api.invoke('recovery:resolve', rec.runId, action)
    } catch (e) {
      useApp.getState().setError(e)
    }
    setPending(pending.slice(1))
    if (action === 'ignore') setRoute('history')
  }
  return (
    <Dialog
      open
      title={t('recovery.title')}
      onClose={() => void resolve('ignore')}
      footer={
        <>
          <Button onClick={() => void resolve('ignore')}>{t('recovery.inspect')}</Button>
          <Button onClick={() => void resolve('undo')}>{t('recovery.undo')}</Button>
          <Button variant="primary" onClick={() => void resolve('complete')}>
            {t('recovery.complete')}
          </Button>
        </>
      }
    >
      <p>
        {t('recovery.body', {
          date: new Date(rec.startedAt).toLocaleString(i18n.language === 'tr' ? 'tr-TR' : 'en-US'),
        })}
      </p>
      <p className="mt-2 text-[13px] text-muted">{t('recovery.safe')}</p>
    </Dialog>
  )
}
