import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../app/api'
import { useApp } from '../../app/store'
import { Button } from '../../components/ui'
import { EstimateDialog } from './EstimateDialog'

/** "Planı oluştur": rules only, or AI estimate first when a provider is configured. */
export function PlanStart(): React.JSX.Element {
  const { t } = useTranslation()
  const summary = useApp((s) => s.summary)
  const provider = useApp((s) => s.settings?.ai.provider ?? 'none')
  const planning = useApp((s) => s.planning)
  const [estimateOpen, setEstimateOpen] = useState(false)

  if (!summary) return <></>
  const onClick = (): void => {
    if (provider !== 'none') setEstimateOpen(true)
    else void buildPlan(summary.sessionId, false)
  }
  return (
    <>
      <Button variant="primary" disabled={planning} onClick={onClick}>
        {planning ? t('plan.building') : t('plan.build')}
      </Button>
      <EstimateDialog
        open={estimateOpen}
        sessionId={summary.sessionId}
        onClose={() => setEstimateOpen(false)}
        onRun={(useAI) => {
          setEstimateOpen(false)
          void buildPlan(summary.sessionId, useAI)
        }}
      />
    </>
  )
}

export async function buildPlan(sessionId: string, useAI: boolean): Promise<void> {
  const { setError } = useApp.getState()
  useApp.setState({ planning: true, planProgress: null })
  try {
    const plan = await api.invoke('plan:build', { sessionId, useAI })
    useApp.setState({ plan, route: 'report' })
  } catch (e) {
    setError(e)
  } finally {
    useApp.setState({ planning: false })
  }
}
