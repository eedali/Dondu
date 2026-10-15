import type { PlanItemPatch } from '@shared/types'
import { api } from '../../app/api'
import { useApp } from '../../app/store'

export async function patchItems(itemIds: string[], patch: PlanItemPatch): Promise<void> {
  const { plan, setError } = useApp.getState()
  if (!plan || !itemIds.length) return
  try {
    useApp.setState({ plan: await api.invoke('plan:update', plan.id, itemIds, patch) })
  } catch (e) {
    setError(e)
  }
}

export async function duplicateForEditing(): Promise<void> {
  const { plan, setError } = useApp.getState()
  if (!plan) return
  try {
    useApp.setState({ plan: await api.invoke('plan:duplicate', plan.id) })
  } catch (e) {
    setError(e)
  }
}

export async function exportReport(format: 'html' | 'md' | 'json'): Promise<string | null> {
  const { plan, setError } = useApp.getState()
  if (!plan) return null
  try {
    return (await api.invoke('plan:export', plan.id, format))?.path ?? null
  } catch (e) {
    setError(e)
    return null
  }
}
