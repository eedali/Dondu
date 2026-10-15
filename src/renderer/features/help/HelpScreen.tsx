import { useTranslation } from 'react-i18next'
import { Layout } from '../../app/Layout'
import { api } from '../../app/api'
import { useApp } from '../../app/store'
import { Button, Card, Tabs } from '../../components/ui'

const TOPICS = ['mac-tcc', 'mac-gatekeeper', 'win-cfa', 'win-smartscreen', 'cloud'] as const
type Topic = (typeof TOPICS)[number]

/** "Nasıl düzeltirim?" pages (docs/04 §4): step by step, per platform. */
export function HelpScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const topic = (useApp((s) => s.helpTopic) as Topic | undefined) ?? defaultTopic()
  const setRoute = useApp((s) => s.setRoute)
  const steps = t(`help.${topic}.steps`, { returnObjects: true }) as unknown as string[]

  return (
    <Layout
      title={t('nav.help')}
      action={<Button onClick={() => setRoute('folders')}>{t('common.back')}</Button>}
    >
      <Tabs
        label={t('nav.help')}
        value={topic}
        onChange={(id) => setRoute('help', id)}
        tabs={TOPICS.map((id) => ({ id, label: t(`help.${id}.tab`) }))}
      />
      <Card className="mt-4 px-6 py-5">
        <h2 className="text-[17px] font-medium">{t(`help.${topic}.title`)}</h2>
        <p className="mt-2 text-muted">{t(`help.${topic}.intro`)}</p>
        <ol className="mt-4 list-decimal space-y-2 pl-5">
          {Array.isArray(steps) && steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
        {topic === 'mac-gatekeeper' && (
          <pre className="selectable mt-4 overflow-auto rounded bg-surface-2 px-3 py-2 font-mono text-[13px]">
            xattr -dr com.apple.quarantine /Applications/Dondu.app
          </pre>
        )}
        <div className="mt-5 flex gap-2">
          {topic === 'mac-tcc' && (
            <>
              <Button
                variant="primary"
                onClick={() => void api.invoke('platform:openPrivacy', 'fullDisk')}
              >
                {t('help.openFullDisk')}
              </Button>
              <Button onClick={() => void api.invoke('platform:openPrivacy', 'filesAndFolders')}>
                {t('help.openFilesFolders')}
              </Button>
            </>
          )}
          {topic === 'win-cfa' && (
            <Button
              variant="primary"
              onClick={() => void api.invoke('platform:openPrivacy', 'controlledFolders')}
            >
              {t('help.openWinSecurity')}
            </Button>
          )}
        </div>
      </Card>
    </Layout>
  )
}

function defaultTopic(): Topic {
  return window.dondu.platform === 'darwin' ? 'mac-tcc' : 'win-cfa'
}
