import { create } from 'zustand'
import { configureApi } from '@/api'
import { db } from '@/db/schema'
import type { AppSettings } from '@/db/types'

interface SettingsState {
  settings: AppSettings | null
  load: () => Promise<AppSettings>
  save: (patch: Partial<Omit<AppSettings, 'id'>>) => Promise<AppSettings>
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  load: async () => {
    const settings = await db.settings.get('app')
    if (!settings) throw new Error('Settings not initialised')
    apply(settings)
    set({ settings })
    return settings
  },
  save: async (patch) => {
    const current = get().settings ?? (await db.settings.get('app'))
    if (!current) throw new Error('Settings not initialised')
    const next: AppSettings = { ...current, ...patch, printer: { ...current.printer, ...(patch.printer ?? {}) } }
    await db.settings.put(next)
    apply(next)
    set({ settings: next })
    return next
  },
}))

function apply(settings: AppSettings) {
  configureApi({ mode: settings.apiMode, baseUrl: settings.apiBaseUrl })
  document.documentElement.classList.toggle('dark', settings.theme === 'dark')
  try {
    localStorage.setItem('pos.theme', settings.theme)
  } catch {
    /* ignore */
  }
}
