import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Plan, PlanItem } from '@shared/types'
import { Button, Dialog, Input, Select } from '../../components/ui'
import { patchItems } from './actions'
import { baseName, rootOf } from './model'

/** Change the target folder of a group (or a single item). Paths stay inside a selected root. */
export function FolderDialog({
  plan,
  items,
  initialRel,
  onClose,
}: {
  plan: Plan
  items: PlanItem[]
  initialRel: string
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const first = items[0]
  const [root, setRoot] = useState(rootOf(plan, first?.targetPath ?? '') ?? plan.roots[0] ?? '')
  const [rel, setRel] = useState(initialRel)
  const sep = root.includes('\\') ? '\\' : '/'
  const save = async (): Promise<void> => {
    const clean = rel
      .split(/[\\/]+/)
      .map((s) => s.trim())
      .filter((s) => s && s !== '.' && s !== '..')
    await patchItems(
      items.map((it) => it.id),
      { targetDir: [root, ...clean].join(sep) },
    )
    onClose()
  }
  return (
    <Dialog
      open
      title={t('report.folderDialog.title')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-muted">
        {t('report.folderDialog.body', { count: items.length })}
      </p>
      {plan.roots.length > 1 && (
        <div className="mb-3">
          <Select
            aria-label={t('report.folderDialog.root')}
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            options={plan.roots.map((r) => ({ value: r, label: r }))}
            className="w-full"
          />
        </div>
      )}
      <label className="block text-[13px] text-muted" htmlFor="dondu-folder-input">
        {t('report.folderDialog.label', { root: baseName(root) })}
      </label>
      <Input
        id="dondu-folder-input"
        className="mt-1 w-full font-mono"
        value={rel}
        onChange={(e) => setRel(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void save()}
        placeholder="Belgeler/Fatura ve Makbuz/2024"
      />
    </Dialog>
  )
}
