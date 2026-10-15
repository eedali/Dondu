import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SecretsStatus } from '@shared/ipc'
import type { RootCheck } from '@shared/types'
import { api, shortPath } from '../../app/api'
import { useApp } from '../../app/store'
import { Logo } from '../../components/Logo'
import { Button, Card, Input, Notice, cx } from '../../components/ui'
import { CheckIcon, CrossIcon } from '../../components/icons'

/** First run (docs/08 §4.1): language → how to understand files → folders → system check. */
export function OnboardingScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const addFolders = useApp((s) => s.addFolders)
  const removeRoot = useApp((s) => s.removeRoot)
  const checks = useApp((s) => s.checks)
  const refreshChecks = useApp((s) => s.refreshChecks)
  const setRoute = useApp((s) => s.setRoute)
  const [secrets, setSecrets] = useState<SecretsStatus | null>(null)
  const [key, setKey] = useState('')
  const [rejected, setRejected] = useState<string[]>([])

  useEffect(() => {
    void api.invoke('secrets:status').then(setSecrets)
  }, [])

  if (!settings) return <div />
  const roots = settings.roots
  const provider = settings.ai.provider
  const allReadable = roots.length > 0 && roots.every((r) => checks[r]?.read)

  const finish = async (): Promise<void> => {
    if (provider === 'anthropic' && key.trim()) {
      setSecrets(await api.invoke('secrets:set', 'anthropicApiKey', key.trim()))
    }
    await update({ onboardingDone: true })
    setRoute('folders')
  }

  return (
    <div className="h-full overflow-auto bg-bg">
      <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-8 py-10">
        <div className="flex flex-col items-start gap-3">
          <Logo height={30} />
          <h1 className="text-[28px] font-semibold">{t('onboarding.title')}</h1>
          <p className="text-muted">{t('onboarding.intro')}</p>
        </div>

        <Step n={1} title={t('onboarding.s1')}>
          <div className="flex gap-2">
            {(['tr', 'en'] as const).map((l) => (
              <Button
                key={l}
                variant={settings.language === l ? 'primary' : 'secondary'}
                aria-pressed={settings.language === l}
                onClick={() => void update({ language: l })}
              >
                {l === 'tr' ? 'Türkçe' : 'English'}
              </Button>
            ))}
          </div>
        </Step>

        <Step n={2} title={t('onboarding.s2')}>
          <div role="radiogroup" aria-label={t('onboarding.s2')} className="grid grid-cols-3 gap-2">
            {(['none', 'anthropic', 'lmstudio'] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={provider === p}
                onClick={() => void update({ ai: { provider: p } })}
                className={cx(
                  'rounded-lg border px-4 py-3 text-left',
                  provider === p
                    ? 'border-accent bg-accent-soft'
                    : 'border-line bg-surface hover:bg-surface-2',
                )}
              >
                <div className="font-medium">{t(`onboarding.provider.${p}.title`)}</div>
                <div className="mt-1 text-[13px] text-muted">
                  {t(`onboarding.provider.${p}.body`)}
                </div>
              </button>
            ))}
          </div>
          {provider === 'anthropic' && (
            <div className="mt-3">
              <label className="text-[13px] text-muted" htmlFor="ob-key">
                {t('settings.apiKey')}
              </label>
              <Input
                id="ob-key"
                type="password"
                autoComplete="off"
                className="mt-1 w-full"
                placeholder={secrets?.anthropicApiKey ? '••••••••' : 'sk-ant-…'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <p className="mt-1 text-[12px] text-muted">{t('onboarding.keyHint')}</p>
            </div>
          )}
          {provider === 'lmstudio' && (
            <p className="mt-3 text-[13px] text-muted">{t('onboarding.lmHint')}</p>
          )}
          <p className="mt-3 text-[13px] text-muted">{t('settings.sensitiveNote')}</p>
        </Step>

        <Step n={3} title={t('onboarding.s3')}>
          <p className="mb-3 text-[13px] text-muted">{t('folders.intro')}</p>
          {rejected.length > 0 && (
            <div className="mb-3">
              <Notice tone="warn">{rejected.join(' · ')}</Notice>
            </div>
          )}
          <ul className="mb-3 flex flex-col gap-1">
            {roots.map((r) => (
              <li
                key={r}
                className="flex items-center justify-between gap-3 rounded-md bg-surface px-3 py-2"
              >
                <span className="truncate font-mono text-[13px]" title={r}>
                  {shortPath(r, 70)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => void removeRoot(r)}>
                  {t('common.remove')}
                </Button>
              </li>
            ))}
          </ul>
          <Button
            onClick={() =>
              void addFolders().then((res) =>
                setRejected(
                  res.rejected.map(
                    (x) => `${shortPath(x.path, 40)}: ${t(`folders.rejected.${x.reason}`)}`,
                  ),
                ),
              )
            }
          >
            {t('folders.add')}
          </Button>
        </Step>

        <Step n={4} title={t('onboarding.s4')}>
          {roots.length === 0 ? (
            <p className="text-[13px] text-muted">{t('onboarding.checkEmpty')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {roots.map((r) => (
                <CheckRow key={r} root={r} check={checks[r]} />
              ))}
              <div>
                <Button size="sm" variant="ghost" onClick={() => void refreshChecks(roots)}>
                  {t('check.retry')}
                </Button>
              </div>
            </div>
          )}
        </Step>

        <div className="flex items-center justify-end gap-3 pb-6">
          {!allReadable && roots.length > 0 && (
            <span className="text-[13px] text-muted">{t('onboarding.fixFirst')}</span>
          )}
          <Button variant="ghost" onClick={() => void finish()}>
            {t('onboarding.later')}
          </Button>
          <Button variant="primary" disabled={!allReadable} onClick={() => void finish()}>
            {t('onboarding.start')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Card className="px-6 py-5">
      <h2 className="mb-3 flex items-center gap-3 text-[17px] font-medium">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-[13px] text-accent-text">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </Card>
  )
}

export function CheckRow({ root, check }: { root: string; check?: RootCheck }): React.JSX.Element {
  const { t } = useTranslation()
  const setRoute = useApp((s) => s.setRoute)
  const name = root.split(/[\\/]/).filter(Boolean).pop() ?? root
  const cell = (ok: boolean | undefined, label: string): React.JSX.Element => (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      {ok === undefined ? (
        <span className="h-3 w-3 rounded-full bg-line" />
      ) : ok ? (
        <CheckIcon />
      ) : (
        <CrossIcon />
      )}
      {label}
    </span>
  )
  const mac = window.dondu.platform === 'darwin'
  return (
    <div className="rounded-md border border-line px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-medium">{name}</span>
        {check && (!check.read || !check.write) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRoute('help', mac ? 'mac-tcc' : 'win-cfa')}
          >
            {t('check.howToFix')}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {cell(check?.read, t('onboarding.c.read'))}
        {cell(check?.write, t('onboarding.c.write'))}
        {cell(
          check ? check.cloud === 'none' : undefined,
          check && check.cloud !== 'none'
            ? t(`check.cloud.${check.cloud}`)
            : t('onboarding.c.cloud'),
        )}
        {cell(
          check ? check.volume !== 'network' : undefined,
          check && check.volume !== 'local' && check.volume !== 'unknown'
            ? t(`check.volume.${check.volume}`)
            : t('onboarding.c.volume'),
        )}
      </div>
    </div>
  )
}
