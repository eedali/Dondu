import { context } from '../context'
import { handle } from './registry'

export function registerPlanIpc(): void {
  handle('plan:get', (planId) => {
    const repos = context().repos
    const id = planId ?? repos.plans.latestId()
    return id ? (repos.plans.get(id) ?? null) : null
  })
}
