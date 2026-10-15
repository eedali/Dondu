import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AiTestResult, AppInfo, SecretsStatus } from '@shared/ipc'
import type { DeepPartial, Settings } from '@shared/settings'
import { Layout } from '../../app/Layout'
import { api } from '../../app/api'
import { useApp } from '../../app/store'
import { Button, Card, Dialog, Field, Input, Notice, Select, Toggle, cx } from '../../components/ui'
import { CategoryEditor } from './CategoryEditor'
import { ModelPicker } from './ModelPicker'
import {
  AI_FIELDS,
  ANTHROPIC_FIELDS,
  LMSTUDIO_FIELDS,
  SECTIONS,
  SIMPLE_SECTIONS,
  getPath,
  patchFor,
  type FieldDef,
  type SectionId,
} from './fields'

export function SettingsScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const initial = useApp((s) => s.helpTopic) as SectionId | undefined
  const [section, setSection] = useState<SectionId>(
    initial && SECTIONS.some((s) => s.id === initial) ? initial : 'organize',
  )
  const [resetOpen, setResetOpen] = useState(false)
  if (!settings) return <Layout title={t('nav.settings')}>{null}</Layout>
  const advanced = settings.advancedSettings
  const visible = SECTIONS.filter((s) => advanced || SIMPLE_SECTIONS.includes(s.id))
  const current = visible.find((s) => s.id === section) ?? visible[0]!

  return (
    <Layout
      title={t('nav.settings')}
      action={
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={advanced}
              onChange={(e) => void update({ advancedSettings: e.target.checked })}
            />
            {t('settings.advanced')}
          </label>
          <Button size="sm" variant="ghost" onClick={() => setResetOpen(true)}>
            {t('settings.reset')}
          </Button>
        </div>
      }
    >
      <div className="flex gap-6">
        <nav className="w-44 shrink-0" aria-label={t('nav.settings')}>
          <ul className="flex flex-col gap-0.5">
            {visible.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={s.id === current.id ? 'page' : undefined}
                  onClick={() => setSection(s.id)}
                  className={cx(
                    'w-full rounded-md px-3 py-1.5 text-left text-[15px]',
                    s.id === current.id ? 'bg-surface-2 font-medium' : 'text-muted hover:text-text',
                  )}
                >
                  {t(`settings.s.${s.id}`)}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">
          <Card className="px-6 py-4">
            <h2 className="mb-1 text-[17px] font-medium">{t(`settings.s.${current.id}`)}</h2>
            {current.id === 'ai' ? (
              <AiSection settings={settings} update={update} />
            ) : current.id === 'categories' ? (
              <CategoryEditor />
            ) : (
              <>
                <FieldList fields={current.fields} settings={settings} update={update} />
                {current.id === 'data' && <DataTools />}
              </>
            )}
          </Card>
        </div>
      </div>
      <Dialog
        open={resetOpen}
        title={t('settings.resetTitle')}
        onClose={() => setResetOpen(false)}
        footer={
          <>
            <Button onClick={() => setResetOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                void api.invoke('settings:reset').then((s) => {
                  useApp.setState({ settings: s })
                  setResetOpen(false)
                })
              }}
            >
              {t('settings.reset')}
            </Button>
          </>
        }
      >
        <p>{t('settings.resetBody')}</p>
      </Dialog>
    </Layout>
  )
}

function FieldList({
  fields,
  settings,
  update,
}: {
  fields: FieldDef[]
  settings: Settings
  update: (p: DeepPartial<Settings>) => Promise<void>
}): React.JSX.Element {
  return (
    <div className="divide-y divide-line">
      {fields.map((f) => (
        <FieldRow key={f.key} def={f} settings={settings} update={update} />
      ))}
    </div>
  )
}

function FieldRow({
  def,
  settings,
  update,
}: {
  def: FieldDef
  settings: Settings
  update: (p: DeepPartial<Settings>) => Promise<void>
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const label = t(`settings.f.${def.key}.label`)
  const descKey = `settings.f.${def.key}.desc`
  const desc = i18n.exists(descKey) ? t(descKey) : undefined
  const value = getPath(settings, def.key)
  const set = (v: unknown): void => void update(patchFor(def.key, v) as DeepPartial<Settings>)

  switch (def.type) {
    case 'bool':
      return (
        <Toggle
          label={label}
          description={def.locked ? `${desc ?? ''} ${t('settings.locked')}`.trim() : desc}
          checked={!!value}
          disabled={def.locked}
          onChange={set}
        />
      )
    case 'number':
      return (
        <Field label={label} description={desc}>
          <NumberInput value={Number(value)} def={def} onCommit={set} />
        </Field>
      )
    case 'text':
      return (
        <Field label={label} description={desc}>
          <TextInput value={String(value ?? '')} onCommit={(v) => set(v || undefined)} />
        </Field>
      )
    case 'select':
      return (
        <Field label={label} description={desc}>
          <Select
            aria-label={label}
            value={String(value)}
            onChange={(e) =>
              set(typeof def.options[0] === 'number' ? Number(e.target.value) : e.target.value)
            }
            options={def.options.map((o) => ({
              value: String(o),
              label: i18n.exists(`settings.o.${def.key}.${o}`)
                ? t(`settings.o.${def.key}.${o}`)
                : String(o),
            }))}
          />
        </Field>
      )
    case 'list':
      return (
        <ListField label={label} desc={desc} value={(value as string[]) ?? []} onCommit={set} />
      )
  }
}

function NumberInput({
  value,
  def,
  onCommit,
}: {
  value: number
  def: Extract<FieldDef, { type: 'number' }>
  onCommit: (v: number) => void
}): React.JSX.Element {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  const commit = (): void => {
    const n = Number(v.replace(',', '.'))
    if (Number.isFinite(n))
      onCommit(Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, n)))
    else setV(String(value))
  }
  return (
    <Input
      className="w-32 text-right"
      inputMode="decimal"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  )
}

function TextInput({
  value,
  onCommit,
}: {
  value: string
  onCommit: (v: string) => void
}): React.JSX.Element {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <Input
      className="w-72"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.key === 'Enter' && onCommit(v)}
    />
  )
}

function ListField({
  label,
  desc,
  value,
  onCommit,
}: {
  label: string
  desc?: string
  value: string[]
  onCommit: (v: string[]) => void
}): React.JSX.Element {
  const [v, setV] = useState(value.join('\n'))
  useEffect(() => setV(value.join('\n')), [value])
  return (
    <div className="py-2">
      <div className="text-[15px]">{label}</div>
      {desc && <div className="text-[13px] text-muted">{desc}</div>}
      <textarea
        aria-label={label}
        className="mt-2 h-32 w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-[12px] text-text focus:border-accent focus:outline-none"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() =>
          onCommit(
            v
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    </div>
  )
}

function AiSection({
  settings,
  update,
}: {
  settings: Settings
  update: (p: DeepPartial<Settings>) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const [secrets, setSecrets] = useState<SecretsStatus | null>(null)
  const [key, setKey] = useState('')
  const [test, setTest] = useState<AiTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const provider = settings.ai.provider

  useEffect(() => {
    void api.invoke('secrets:status').then(setSecrets)
  }, [])
  useEffect(() => {
    setTest(null)
    if (provider === 'lmstudio')
      void api
        .invoke('ai:models')
        .then(setModels)
        .catch(() => setModels([]))
  }, [provider, settings.ai.lmstudio.baseUrl])

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTest(await api.invoke('ai:test'))
    setTesting(false)
  }

  return (
    <div>
      <p className="mb-3 text-[13px] text-muted">{t('settings.aiIntro')}</p>
      <div
        role="radiogroup"
        aria-label={t('settings.f.ai.provider.label')}
        className="mb-4 grid grid-cols-3 gap-2"
      >
        {(['none', 'anthropic', 'lmstudio'] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={provider === p}
            onClick={() => void update({ ai: { provider: p } })}
            className={cx(
              'rounded-lg border px-4 py-3 text-left',
              provider === p ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2',
            )}
          >
            <div className="font-medium">{t(`ai.provider.${p}`)}</div>
            <div className="text-[13px] text-muted">{t(`settings.providerDesc.${p}`)}</div>
          </button>
        ))}
      </div>

      {provider === 'anthropic' && (
        <div className="divide-y divide-line">
          <Field
            label={t('settings.apiKey')}
            description={
              secrets?.anthropicApiKey ? t('settings.apiKeySaved') : t('settings.apiKeyDesc')
            }
          >
            <div className="flex gap-2">
              <Input
                type="password"
                autoComplete="off"
                className="w-64"
                placeholder={secrets?.anthropicApiKey ? '••••••••' : 'sk-ant-…'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!key || !secrets?.encryptionAvailable}
                onClick={() =>
                  void api.invoke('secrets:set', 'anthropicApiKey', key.trim()).then((s) => {
                    setSecrets(s)
                    setKey('')
                  })
                }
              >
                {t('common.save')}
              </Button>
              {secrets?.anthropicApiKey && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void api.invoke('secrets:set', 'anthropicApiKey', null).then(setSecrets)
                  }
                >
                  {t('common.remove')}
                </Button>
              )}
            </div>
          </Field>
          {secrets && !secrets.encryptionAvailable && (
            <Notice tone="warn">{t('settings.noEncryption')}</Notice>
          )}
          <ModelPicker
            label={t('settings.f.ai.anthropic.model.label')}
            description={t('settings.f.ai.anthropic.model.desc')}
            value={settings.ai.anthropic.model}
            onChange={(m) => void update({ ai: { anthropic: { model: m } } })}
          />
          <ModelPicker
            label={t('settings.f.ai.anthropic.organizerModel.label')}
            description={t('settings.f.ai.anthropic.organizerModel.desc')}
            value={settings.ai.anthropic.organizerModel}
            onChange={(m) => void update({ ai: { anthropic: { organizerModel: m } } })}
          />
          <FieldList fields={ANTHROPIC_FIELDS} settings={settings} update={update} />
        </div>
      )}

      {provider === 'lmstudio' && (
        <div className="divide-y divide-line">
          <FieldList fields={LMSTUDIO_FIELDS} settings={settings} update={update} />
          <Field
            label={t('settings.f.ai.lmstudio.model.label')}
            description={t('settings.f.ai.lmstudio.model.desc')}
          >
            <Select
              aria-label={t('settings.f.ai.lmstudio.model.label')}
              value={settings.ai.lmstudio.model}
              onChange={(e) => void update({ ai: { lmstudio: { model: e.target.value } } })}
              options={[
                {
                  value: '',
                  label: models.length ? t('settings.pickModel') : t('settings.noModels'),
                },
                ...models.map((m) => ({ value: m, label: m })),
              ]}
            />
          </Field>
          {/^https?:\/\/(?!localhost|127\.)/.test(settings.ai.lmstudio.baseUrl) && (
            <Notice tone="warn">{t('settings.lanWarning')}</Notice>
          )}
        </div>
      )}

      {provider !== 'none' && (
        <>
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={() => void runTest()} disabled={testing}>
              {t('settings.testConnection')}
            </Button>
            {test && (
              <span
                className={cx('text-[13px]', test.ok ? 'text-accent-text' : 'text-error')}
                role="status"
              >
                {test.ok ? t('settings.testOk', { model: test.model ?? '' }) : test.message}
              </span>
            )}
          </div>
          <div className="mt-4 divide-y divide-line border-t border-line">
            <FieldList fields={AI_FIELDS} settings={settings} update={update} />
          </div>
          <p className="mt-3 text-[13px] text-muted">{t('settings.sensitiveNote')}</p>
        </>
      )}
    </div>
  )
}

function DataTools(): React.JSX.Element {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    void api.invoke('app:info').then(setInfo)
  }, [])
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            void api
              .invoke('cache:clear')
              .then((r) => setMsg(t('settings.cacheCleared', { thumbs: r.thumbs, ai: r.ai })))
          }
        >
          {t('settings.clearCache')}
        </Button>
        <Button size="sm" onClick={() => void api.invoke('shell:openLogs')}>
          {t('settings.openLogs')}
        </Button>
        {info && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void api.invoke('shell:reveal', info.userData)}
          >
            {t('settings.openData')}
          </Button>
        )}
      </div>
      {msg && <Notice tone="accent">{msg}</Notice>}
      {info && (
        <p className="selectable text-[12px] text-muted">
          Döndü {info.version} · {info.platform}/{info.arch} · {info.dbBackend}
          <br />
          <span className="font-mono">{info.userData}</span>
        </p>
      )}
    </div>
  )
}
