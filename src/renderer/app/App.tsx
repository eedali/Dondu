import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PingResult } from '@shared/ipc'
import { Layout } from './Layout'
import { useUi } from './store'
import { useTheme } from './useTheme'

export function App(): React.JSX.Element {
  const { t } = useTranslation()
  const route = useUi((s) => s.route)
  const [ping, setPing] = useState<PingResult | null>(null)
  useTheme('system')

  useEffect(() => {
    void window.dondu.ping().then(setPing)
  }, [])

  return (
    <Layout
      title={t(`nav.${route}`)}
      status={
        ping
          ? t('status.connected', { platform: ping.platform, version: ping.version })
          : t('status.idle')
      }
      disabled={['report']}
    >
      <div className="rounded-lg border border-line bg-surface p-8">
        <h2 className="text-[17px] font-medium">{t('placeholder.title')}</h2>
        <p className="mt-2 text-muted">{t('placeholder.body')}</p>
      </div>
    </Layout>
  )
}
