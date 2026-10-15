import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from './store'
import { useTheme } from './useTheme'
import { ErrorToast } from './ErrorToast'
import { FoldersScreen } from '../features/folders/FoldersScreen'
import { ScanScreen } from '../features/scan/ScanScreen'
import { ReportScreen } from '../features/report/ReportScreen'
import { ApplyScreen } from '../features/apply/ApplyScreen'
import { RecoveryDialog } from '../features/apply/RecoveryDialog'
import { HistoryScreen } from '../features/history/HistoryScreen'
import { SettingsScreen } from '../features/settings/SettingsScreen'
import { OnboardingScreen } from '../features/onboarding/OnboardingScreen'
import { HelpScreen } from '../features/help/HelpScreen'
import { PlanningPanel } from '../features/plan/PlanningPanel'

export function App(): React.JSX.Element {
  const { i18n } = useTranslation()
  const ready = useApp((s) => s.ready)
  const init = useApp((s) => s.init)
  const route = useApp((s) => s.route)
  const settings = useApp((s) => s.settings)
  useTheme(settings?.theme ?? 'system')

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const lang = settings?.language === 'en' ? 'en' : 'tr'
    if (settings && i18n.language !== lang) void i18n.changeLanguage(lang)
    document.documentElement.lang = lang
  }, [settings, i18n])

  if (!ready) return <div className="h-full bg-bg" />

  if (settings && !settings.onboardingDone && route !== 'help')
    return (
      <>
        <OnboardingScreen />
        <ErrorToast />
      </>
    )

  const screen = (() => {
    switch (route) {
      case 'folders':
        return <FoldersScreen />
      case 'scan':
        return <ScanScreen />
      case 'report':
        return <ReportScreen />
      case 'apply':
        return <ApplyScreen />
      case 'history':
        return <HistoryScreen />
      case 'settings':
        return <SettingsScreen />
      case 'help':
        return <HelpScreen />
      default:
        return <FoldersScreen />
    }
  })()

  return (
    <>
      {screen}
      <PlanningPanel />
      <RecoveryDialog />
      <ErrorToast />
    </>
  )
}
