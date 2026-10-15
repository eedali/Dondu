import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MODEL_PRESETS, presetFor } from '@shared/models'
import { api } from '../../app/api'
import { Button, Field, Input, Select } from '../../components/ui'

const OTHER = '__other__'

/** Ready-made Claude model choices (revision 2) + models from the API + a free-text "Diğer…". */
export function ModelPicker({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description?: string
  value: string
  onChange: (model: string) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [remote, setRemote] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const known = !!presetFor(value) || remote.some((m) => m.id === value)
  const [custom, setCustom] = useState(!known)
  const [draft, setDraft] = useState(known ? '' : value)
  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US'
  const money = (n: number): string =>
    `$${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setRemote(await api.invoke('ai:anthropicModels'))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const options = [
    ...MODEL_PRESETS.map((m) => ({
      value: m.id,
      label: `${m.name} — ${t(`settings.modelNote.${m.note}`)} · ${money(m.input)} / ${money(m.output)}`,
    })),
    ...remote
      .filter((m) => !presetFor(m.id) && m.id.startsWith('claude'))
      .map((m) => ({ value: m.id, label: `${m.name} (${m.id})` })),
    { value: OTHER, label: t('settings.modelOther') },
  ]

  return (
    <div className="py-2">
      <Field label={label} description={description}>
        <div className="flex flex-col items-end gap-2">
          <Select
            aria-label={label}
            className="w-[360px]"
            value={custom ? OTHER : value}
            onChange={(e) => {
              if (e.target.value === OTHER) {
                setCustom(true)
                setDraft(value)
              } else {
                setCustom(false)
                onChange(e.target.value)
              }
            }}
            options={options}
          />
          {custom && (
            <div className="flex gap-2">
              <Input
                className="w-64 font-mono"
                placeholder="claude-…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && draft.trim() && onChange(draft.trim())}
              />
              <Button size="sm" disabled={!draft.trim()} onClick={() => onChange(draft.trim())}>
                {t('common.save')}
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            {error && <span className="text-[12px] text-error">{error}</span>}
            <Button size="sm" variant="ghost" disabled={loading} onClick={() => void refresh()}>
              {t('settings.refreshModels')}
            </Button>
          </div>
        </div>
      </Field>
      {custom && (
        <p className="text-right text-[12px] text-muted">{t('settings.modelOtherHint')}</p>
      )}
    </div>
  )
}
