import { create } from 'zustand'
import type { PlanProgress } from '@shared/ipc'
import type { DeepPartial, Settings } from '@shared/settings'
import type {
  AIEstimate,
  ApplyProgress,
  Category,
  Plan,
  RootCheck,
  ScanProgress,
  ScanSummary,
} from '@shared/types'
import { api, errorMessage } from './api'

export type Route = 'folders' | 'scan' | 'report' | 'apply' | 'history' | 'settings' | 'help'

interface AppState {
  ready: boolean
  route: Route
  helpTopic?: string
  settings: Settings | null
  categories: Category[]
  checks: Record<string, RootCheck>
  scanProgress: ScanProgress | null
  scanning: boolean
  summary: ScanSummary | null
  estimate: AIEstimate | null
  planProgress: PlanProgress | null
  planning: boolean
  plan: Plan | null
  applyProgress: ApplyProgress | null
  error: string | null

  init: () => Promise<void>
  setRoute: (route: Route, helpTopic?: string) => void
  updateSettings: (patch: DeepPartial<Settings>) => Promise<void>
  setError: (e: unknown) => void
  refreshChecks: (roots?: string[]) => Promise<void>
  addFolders: () => Promise<{ rejected: { path: string; reason: string }[] }>
  removeRoot: (root: string) => Promise<void>
  startScan: () => Promise<void>
  cancelScan: () => Promise<void>
  loadPlan: (planId?: string) => Promise<void>
  setPlan: (plan: Plan | null) => void
  setCategories: (c: Category[]) => void
}

let initStarted = false

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  route: 'folders',
  settings: null,
  categories: [],
  checks: {},
  scanProgress: null,
  scanning: false,
  summary: null,
  estimate: null,
  planProgress: null,
  planning: false,
  plan: null,
  applyProgress: null,
  error: null,

  async init() {
    if (initStarted) return
    initStarted = true
    const [settings, categories, summary, plan] = await Promise.all([
      api.invoke('settings:get'),
      api.invoke('categories:list'),
      api.invoke('scan:summary'),
      api.invoke('plan:get'),
    ])
    set({ settings, categories, summary, plan, ready: true })
    api.on('scan:progress', (p) => {
      const done = p.phase === 'done' || p.phase === 'cancelled' || p.phase === 'error'
      set({ scanProgress: p, scanning: !done })
      if (p.phase === 'error') set({ error: p.message ?? 'scan_failed' })
      if (done && p.phase !== 'error')
        void api.invoke('scan:summary', p.sessionId).then((s) => set({ summary: s }))
    })
    api.on('plan:progress', (p) => set({ planProgress: p }))
    api.on('apply:progress', (p) => set({ applyProgress: p }))
    api.on('app:error', (e) => set({ error: e.message }))
    const params = new URLSearchParams(location.search)
    const route = params.get('route') as Route | null
    if (route) set({ route })
    if (settings.roots.length) void get().refreshChecks(settings.roots)
    if (params.get('autoscan')) void get().startScan()
  },

  setRoute: (route, helpTopic) => set({ route, helpTopic }),

  async updateSettings(patch) {
    try {
      const settings = await api.invoke('settings:set', patch)
      set({ settings })
    } catch (e) {
      get().setError(e)
    }
  },

  setError: (e) => set({ error: e === null ? null : errorMessage(e) }),

  async refreshChecks(roots) {
    const list = roots ?? get().settings?.roots ?? []
    if (!list.length) return
    const res = await api.invoke('platform:check', list)
    set({ checks: { ...get().checks, ...Object.fromEntries(res.map((r) => [r.root, r])) } })
  },

  async addFolders() {
    const res = await api.invoke('folders:pick')
    const settings = await api.invoke('settings:get')
    set({ settings })
    if (res.accepted.length) await get().refreshChecks(res.accepted)
    return res
  },

  async removeRoot(root) {
    const roots = (get().settings?.roots ?? []).filter((r) => r !== root)
    await get().updateSettings({ roots })
  },

  async startScan() {
    const roots = get().settings?.roots ?? []
    if (!roots.length) return
    set({ scanning: true, scanProgress: null, summary: null, error: null, route: 'scan' })
    try {
      await api.invoke('scan:start', roots)
    } catch (e) {
      set({ scanning: false })
      get().setError(e)
    }
  },

  async cancelScan() {
    await api.invoke('scan:cancel')
  },

  async loadPlan(planId) {
    set({ plan: await api.invoke('plan:get', planId) })
  },

  setPlan: (plan) => set({ plan }),
  setCategories: (categories) => set({ categories }),
}))
