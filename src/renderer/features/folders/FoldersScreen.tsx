import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RootCheck } from '@shared/types'
import { Layout } from '../../app/Layout'
import { useApp } from '../../app/store'
import { api, shortPath } from '../../app/api'
import { Badge, Button, Card, EmptyState, Notice } from '../../components/ui'
import { StatusLine } from '../../app/StatusLine'

export function FoldersScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const settings = useApp((s) => s.settings)
  const checks = useApp((s) => s.checks)
  const addFolders = useApp((s) => s.addFolders)
  const removeRoot = useApp((s) => s.removeRoot)
  const startScan = useApp((s) => s.startScan)
  const refreshChecks = useApp((s) => s.refreshChecks)
  const scanning = useApp((s) => s.scanning)
  const [rejected, setRejected] = useState<{ path: string; reason: string }[]>([])
  const roots = settings?.roots ?? []
  const blocked = roots.some((r) => checks[r] && (!checks[r].read || !checks[r].exists))

  const onAdd = async (): Promise<void> => {
    const res = await addFolders()
    setRejected(res.rejected)
  }

  return (
    <Layout
      title={t('folders.title')}
      action={
        <Button variant={roots.length ? 'secondary' : 'primary'} onClick={() => void onAdd()}>
          {t('folders.add')}
        </Button>
      }
      footer={
        <>
          <StatusLine />
          <Button
            variant="primary"
            disabled={!roots.length || scanning || blocked}
            onClick={() => void startScan()}
          >
            {t('folders.scan')}
          </Button>
        </>
      }
    >
      <p className="mb-5 text-muted">{t('folders.intro')}</p>

      {rejected.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">
            {rejected.map((r) => (
              <div key={r.path}>
                <span className="font-mono">{shortPath(r.path, 60)}</span> —{' '}
                {t(`folders.rejected.${r.reason}`)}
              </div>
            ))}
          </Notice>
        </div>
      )}

      {roots.length === 0 ? (
        <EmptyState
          title={t('folders.emptyTitle')}
          body={t('folders.emptyBody')}
          action={
            <Button variant="primary" onClick={() => void onAdd()}>
              {t('folders.add')}
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {roots.map((r) => (
            <li key={r}>
              <RootCard
                root={r}
                check={checks[r]}
                onRemove={() => void removeRoot(r)}
                onRecheck={() => void refreshChecks([r])}
              />
            </li>
          ))}
        </ul>
      )}
    </Layout>
  )
}

function RootCard({
  root,
  check,
  onRemove,
  onRecheck,
}: {
  root: string
  check?: RootCheck
  onRemove: () => void
  onRecheck: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const setRoute = useApp((s) => s.setRoute)
  const name = root.split(/[\\/]/).filter(Boolean).pop() ?? root
  const problem = check && (!check.exists || !check.read || !check.write)
  return (
    <Card className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[17px] font-medium">{name}</div>
          <div className="selectable truncate font-mono text-[13px] text-muted" title={root}>
            {root}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!check ? (
              <Badge>{t('folders.checking')}</Badge>
            ) : (
              <>
                <Badge tone={check.read ? 'accent' : 'error'}>
                  {check.read ? t('check.readOk') : t('check.readNo')}
                </Badge>
                <Badge tone={check.write ? 'accent' : 'warn'}>
                  {check.write ? t('check.writeOk') : t('check.writeNo')}
                </Badge>
                {check.cloud !== 'none' && (
                  <Badge tone="warn">{t(`check.cloud.${check.cloud}`)}</Badge>
                )}
                {check.volume !== 'local' && check.volume !== 'unknown' && (
                  <Badge>{t(`check.volume.${check.volume}`)}</Badge>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="sm" onClick={() => void api.invoke('shell:reveal', root)}>
            {t('common.reveal')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={t('folders.remove', { name })}
          >
            {t('common.remove')}
          </Button>
        </div>
      </div>
      {problem && (
        <div className="mt-3">
          <Notice tone={check.read ? 'warn' : 'error'}>
            <div>{t(problemKey(check))}</div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={onRecheck}>
                {t('check.retry')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRoute('help', helpTopic(check))}>
                {t('check.howToFix')}
              </Button>
            </div>
          </Notice>
        </div>
      )}
      {check?.cloud === 'icloud' || check?.cloud === 'onedrive' ? (
        <p className="mt-2 text-[13px] text-muted">{t('check.cloudHint')}</p>
      ) : null}
    </Card>
  )
}

function problemKey(c: RootCheck): string {
  if (!c.exists) return 'check.problem.missing'
  if (!c.read)
    return window.dondu.platform === 'darwin' ? 'check.problem.readMac' : 'check.problem.read'
  return window.dondu.platform === 'win32' ? 'check.problem.writeWin' : 'check.problem.write'
}

function helpTopic(c: RootCheck): string {
  if (window.dondu.platform === 'darwin') return 'mac-tcc'
  if (!c.write) return 'win-cfa'
  return 'general'
}
