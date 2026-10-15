import { useEffect } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'

/** Applies `data-theme` on <html> and follows the OS when preference is "system". */
export function useTheme(pref: ThemePref): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = pref === 'dark' || (pref === 'system' && media.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [pref])
}
