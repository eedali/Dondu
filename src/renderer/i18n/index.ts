import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import tr from './tr.json'
import en from './en.json'

export const resources = { tr: { translation: tr }, en: { translation: en } } as const

export type Lang = 'tr' | 'en'

export function detectLanguage(): Lang {
  return navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: 'tr',
  interpolation: { escapeValue: false },
})

export default i18n
