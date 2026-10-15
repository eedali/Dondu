import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Plan } from '@shared/types'
import { api } from '../../app/api'
import { useApp } from '../../app/store'
import { Button, Dialog, Input } from '../../components/ui'

/**
 * Rename (or merge) a proposed folder: everything going into it — including its sub-folders —
 * goes to the new path. Typing an existing folder's path merges the two (revision 1).
 */
export function RenameFolderDialog({
  plan,
  root,
  rel,
  onClose,
}: {
  plan: Plan
  root: string
  rel: string
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [value, setValue] = useState(rel)
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    if (!value.trim() || value.trim() === rel) return onClose()
    setBusy(true)
    try {
      useApp.setState({
        plan: await api.invoke('plan:renameFolder', plan.id, root, rel, value.trim()),
      })
      onClose()
    } catch (e) {
      useApp.getState().setError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={t('report.renameTitle')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-muted">{t('report.renameBody')}</p>
      <Input
        autoFocus
        className="w-full font-mono"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void save()}
        aria-label={t('report.renameTitle')}
      />
      <p className="mt-2 text-[12px] text-muted">{t('report.renameHint')}</p>
    </Dialog>
  )
}
