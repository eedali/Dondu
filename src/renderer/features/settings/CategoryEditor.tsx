import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Category } from '@shared/types'
import { api } from '../../app/api'
import { useApp } from '../../app/store'
import { Badge, Button, Dialog, Input } from '../../components/ui'

/** Category editor (docs/06 §10): rename, folder template, enable, add, delete custom, reset. */
export function CategoryEditor(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const categories = useApp((s) => s.categories)
  const setCategories = useApp((s) => s.setCategories)
  const [edit, setEdit] = useState<Category | null>(null)
  const [resetOpen, setResetOpen] = useState(false)

  const save = async (c: Category): Promise<void> => {
    setCategories(await api.invoke('categories:save', c))
    setEdit(null)
  }

  return (
    <div>
      <p className="mb-3 text-[13px] text-muted">{t('categories.intro')}</p>
      <ul className="divide-y divide-line">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              aria-label={t('categories.enabled', { name: c.nameTr })}
              checked={c.enabled}
              disabled={c.id === 'uncertain'}
              onChange={(e) => void save({ ...c, enabled: e.target.checked })}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate">{i18n.language === 'tr' ? c.nameTr : c.nameEn}</span>
                {!c.builtin && <Badge>{t('categories.custom')}</Badge>}
              </div>
              <div className="truncate font-mono text-[12px] text-muted">{c.folderTemplate}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEdit(c)}>
              {t('categories.edit')}
            </Button>
            {!c.builtin && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void api.invoke('categories:remove', c.id).then(setCategories)}
              >
                {t('common.remove')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          onClick={() =>
            setEdit({
              id: '',
              nameTr: '',
              nameEn: '',
              folderTemplate: 'Belgeler/',
              description: '',
              examples: [],
              enabled: true,
              sort: (categories.at(-1)?.sort ?? 0) + 5,
              builtin: false,
            })
          }
        >
          {t('categories.add')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setResetOpen(true)}>
          {t('categories.reset')}
        </Button>
      </div>
      <p className="mt-3 text-[12px] text-muted">{t('categories.templateHelp')}</p>

      {edit && (
        <EditDialog value={edit} onClose={() => setEdit(null)} onSave={(c) => void save(c)} />
      )}
      <Dialog
        open={resetOpen}
        title={t('categories.reset')}
        onClose={() => setResetOpen(false)}
        footer={
          <>
            <Button onClick={() => setResetOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() =>
                void api.invoke('categories:reset').then((c) => {
                  setCategories(c)
                  setResetOpen(false)
                })
              }
            >
              {t('categories.reset')}
            </Button>
          </>
        }
      >
        <p>{t('categories.resetBody')}</p>
      </Dialog>
    </div>
  )
}

function EditDialog({
  value,
  onClose,
  onSave,
}: {
  value: Category
  onClose: () => void
  onSave: (c: Category) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [c, setC] = useState(value)
  const field = (
    k: 'nameTr' | 'nameEn' | 'folderTemplate' | 'description',
    label: string,
    mono = false,
  ): React.JSX.Element => (
    <label className="block">
      <span className="text-[13px] text-muted">{label}</span>
      <Input
        className={mono ? 'mt-1 w-full font-mono' : 'mt-1 w-full'}
        value={c[k]}
        onChange={(e) => setC({ ...c, [k]: e.target.value })}
      />
    </label>
  )
  return (
    <Dialog
      open
      title={value.id ? t('categories.edit') : t('categories.add')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!c.nameTr.trim() || !c.folderTemplate.trim()}
            onClick={() => onSave({ ...c, nameEn: c.nameEn.trim() || c.nameTr.trim() })}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {field('nameTr', t('categories.nameTr'))}
        {field('nameEn', t('categories.nameEn'))}
        {field('folderTemplate', t('categories.template'), true)}
        {field('description', t('categories.description'))}
        <label className="block">
          <span className="text-[13px] text-muted">{t('categories.examples')}</span>
          <Input
            className="mt-1 w-full"
            value={c.examples.join(', ')}
            onChange={(e) =>
              setC({
                ...c,
                examples: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      </div>
    </Dialog>
  )
}
