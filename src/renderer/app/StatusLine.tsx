import { useTranslation } from 'react-i18next'
import { useApp } from './store'

/** Bottom bar text: always says what happens next (docs/08 §3). */
export function StatusLine(): React.JSX.Element {
  const { t } = useTranslation()
  const roots = useApp((s) => s.settings?.roots.length ?? 0)
  const scanning = useApp((s) => s.scanning)
  const progress = useApp((s) => s.scanProgress)
  const plan = useApp((s) => s.plan)
  const summary = useApp((s) => s.summary)

  let text: string
  if (scanning && progress) {
    text =
      progress.phase === 'walking'
        ? t('status.walking', { count: progress.found })
        : t('status.scanPct', {
            pct: progress.total ? Math.round((progress.analyzed / progress.total) * 100) : 0,
          })
  } else if (plan && plan.status === 'draft') {
    text = t('status.planReady', { move: plan.summary.move, quarantine: plan.summary.quarantine })
  } else if (summary && summary.status === 'done') {
    text = t('status.scanDone', { count: summary.totalFiles })
  } else if (roots) {
    text = t('status.foldersSelected', { count: roots })
  } else {
    text = t('status.noFolders')
  }
  return <span className="text-[13px] text-muted">{text}</span>
}
