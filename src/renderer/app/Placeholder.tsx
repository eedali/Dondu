import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/ui'
import { Layout } from './Layout'
import { useApp } from './store'

export function Placeholder(): React.JSX.Element {
  const { t } = useTranslation()
  const route = useApp((s) => s.route)
  return (
    <Layout title={t(`nav.${route}`)}>
      <EmptyState title={t('placeholder.title')} body={t('placeholder.body')} />
    </Layout>
  )
}
