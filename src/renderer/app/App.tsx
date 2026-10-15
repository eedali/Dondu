import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from './store'
import { useTheme } from './useTheme'
import { FoldersScreen } from '../features/folders/FoldersScreen'
import { ScanScreen } from '../features/scan/ScanScreen'
import { Placeholder } from './Placeholder'
import { ErrorToast } from './ErrorToast'

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

  return (
    <>
      {route === 'folders' && <FoldersScreen />}
      {route === 'scan' && <ScanScreen />}
      {route !== 'folders' && route !== 'scan' && <Placeholder />}
      <ErrorToast />
    </>
  )
}
