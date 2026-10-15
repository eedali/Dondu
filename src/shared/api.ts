import type { PingResult } from './ipc'

/** Shape of `window.dondu`, exposed by the preload script. */
export interface DonduApi {
  ping(): Promise<PingResult>
}
