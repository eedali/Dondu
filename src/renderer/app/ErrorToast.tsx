import { useTranslation } from 'react-i18next'
import { useApp } from './store'

/** Calm, dismissible error banner (bottom-right). Red only for real errors. */
export function ErrorToast(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const error = useApp((s) => s.error)
  const setError = useApp((s) => s.setError)
  if (!error) return null
  const key = `errors.${error}`
  const text = i18n.exists(key) ? t(key) : error
  return (
    <div
      role="alert"
      className="fixed bottom-20 right-6 z-40 flex max-w-md items-start gap-3 rounded-md border border-line bg-surface px-4 py-3 shadow-lg"
    >
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-error" />
      <span className="text-[13px]">{text}</span>
      <button
        type="button"
        className="ml-2 text-[13px] text-muted hover:text-text"
        onClick={() => setError(null)}
      >
        {t('common.close')}
      </button>
    </div>
  )
}
