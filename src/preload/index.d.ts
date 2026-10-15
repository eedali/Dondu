import type { DonduApi } from '../shared/api'

declare global {
  interface Window {
    dondu: DonduApi
  }
}

export {}
