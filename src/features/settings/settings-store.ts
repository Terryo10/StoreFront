import { create } from 'zustand'
import { db, type AppSettings } from '@/db/schema'

interface SettingsState {
  settings: AppSettings | null
  load: () => Promise<void>
  save: (patch: Partial<Omit<AppSettings, 'id'>>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  load: async () => {
    const settings = (await db.settings.get('app')) ?? null
    set({ settings })
    applyTheme(settings?.theme ?? 'light')
  },
  save: async (patch) => {
    const current = get().settings ?? (await db.settings.get('app'))
    if (!current) return
    const next = { ...current, ...patch }
    await db.settings.put(next)
    set({ settings: next })
    if (patch.theme) applyTheme(patch.theme)
  },
}))

function applyTheme(theme: AppSettings['theme']) {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = theme === 'dark' || (theme === 'system' && prefersDark)
  root.classList.toggle('dark', dark)
}
