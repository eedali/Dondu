import { create } from 'zustand'

export type Route = 'folders' | 'scan' | 'report' | 'history' | 'settings'

interface UiState {
  route: Route
  setRoute: (route: Route) => void
}

export const useUi = create<UiState>((set) => ({
  route: 'folders',
  setRoute: (route) => set({ route }),
}))
