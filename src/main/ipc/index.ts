import { registerAppIpc } from './app'
import { registerFolderIpc } from './folders'
import { registerPlanIpc } from './plan'

export function registerIpc(): void {
  registerAppIpc()
  registerFolderIpc()
  registerPlanIpc()
}
