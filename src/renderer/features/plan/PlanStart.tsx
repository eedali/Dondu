import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui'

/** Starts plan building (rules, optional AI estimate). Implemented in phase 2/3. */
export function PlanStart(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Button variant="primary" disabled>
      {t('plan.build')}
    </Button>
  )
}
