import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app/theme.css'
import './i18n'
import { App } from './app/App'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
