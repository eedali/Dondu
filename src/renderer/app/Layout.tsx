import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Logo } from '../components/Logo'
import { useApp, type Route } from './store'

const NAV: Route[] = ['folders', 'scan', 'report', 'history', 'settings']

/** Sub-screens highlight their parent nav item. */
const PARENT: Partial<Record<Route, Route>> = { apply: 'report', help: 'settings' }

export function Layout({
  title,
  action,
  footer,
  status,
  disabled = [],
  children,
  wide = false,
}: {
  title: string
  action?: ReactNode
  footer?: ReactNode
  status?: ReactNode
  disabled?: Route[]
  children: ReactNode
  wide?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const route = useApp((s) => s.route)
  const setRoute = useApp((s) => s.setRoute)
  const hasPlan = useApp((s) => !!s.plan)
  const applying = useApp(
    (s) => s.applyProgress?.status === 'running' || s.applyProgress?.status === 'paused',
  )
  const current = PARENT[route] ?? route
  const autoDisabled: Route[] = hasPlan ? [] : ['report']

  return (
    <div className="flex h-full">
      <nav
        className="flex w-[200px] shrink-0 flex-col border-r border-line bg-surface"
        aria-label={t('nav.label')}
      >
        <div className="px-5 pb-6 pt-6">
          <Logo />
        </div>
        <ul className="flex flex-col gap-1 px-3">
          {NAV.map((r) => {
            const isDisabled =
              disabled.includes(r) || autoDisabled.includes(r) || (applying && r !== current)
            const active = r === current
            return (
              <li key={r}>
                <button
                  type="button"
                  disabled={isDisabled}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setRoute(r === 'report' && applying ? 'apply' : r)}
                  className={[
                    'w-full rounded-md px-3 py-2 text-left text-[15px]',
                    active
                      ? 'bg-accent-soft font-medium text-accent-text'
                      : 'text-text hover:bg-surface-2',
                    isDisabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : '',
                  ].join(' ')}
                >
                  {t(`nav.${r}`)}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="mt-auto px-5 py-4 text-[13px] text-muted">{status}</div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line px-8">
          <h1 className="truncate text-[22px] font-semibold">{title}</h1>
          <div className="flex items-center gap-2">{action}</div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <div
            className={['mx-auto px-8 py-6', wide ? 'max-w-[1280px]' : 'max-w-[960px]'].join(' ')}
          >
            {children}
          </div>
        </main>
        {footer ? (
          <footer className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-t border-line bg-surface px-8 py-2">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
