import Dexie from 'dexie'
import { create } from 'zustand'
import { setUnauthorizedHandler } from '@/api'
import { db } from '@/db/schema'
import { ensureBaseline, seedDemoData } from '@/db/seed'
import { useAuth } from '@/features/auth/auth-store'
import { useCart } from '@/features/sale/cart-store'
import { EMPTY_CART } from '@/features/sale/sale-service'
import { getOpenShift } from '@/features/shift/shift-service'
import { useSettings } from '@/features/settings/settings-store'
import { getStorageStatus, requestPersistentStorage, type StorageStatus } from '@/lib/storage'
import { track } from '@/lib/telemetry'
import { recoverInterruptedSync } from '@/services/sync-engine'

export interface BootReport {
  recoveredCartLines: number
  recoveredSyncEvents: number
  storage: StorageStatus | null
  persistDenied: boolean
}

interface BootState {
  status: 'booting' | 'ready' | 'failed'
  error: string | null
  report: BootReport | null
  setStorage: (s: StorageStatus) => void
}

export const useBoot = create<BootState>((set) => ({
  status: 'booting',
  error: null,
  report: null,
  setStorage: (storage) => set((s) => (s.report ? { report: { ...s.report, storage } } : s)),
}))

export async function boot(): Promise<void> {
  try {
    // Remove the database left behind by the previous stocktake-only build.
    if ((await Dexie.exists('stocktake_v1').catch(() => false)) === true) await Dexie.delete('stocktake_v1').catch(() => undefined)

    await db.open()
    await ensureBaseline()
    const settings = await useSettings.getState().load()
    if (settings.apiMode === 'mock') await seedDemoData()
    const recoveredSyncEvents = await recoverInterruptedSync()

    await useAuth.getState().hydrate()
    setUnauthorizedHandler(() => {
      track('auth.unauthorized', {}, 'warn')
    })

    const shift = await getOpenShift()
    const active = await db.activeCart.get('current')
    let recoveredCartLines = 0
    if (active && (!shift || active.shiftId === shift.id || active.shiftId === null)) {
      useCart.getState().load({ lines: active.lines, voided: active.voided, startedAt: active.startedAt }, shift?.id ?? null)
      recoveredCartLines = active.lines.length
    } else {
      useCart.getState().load(EMPTY_CART, shift?.id ?? null)
    }

    const persisted = await requestPersistentStorage()
    const storage = await getStorageStatus()
    useBoot.setState({ status: 'ready', report: { recoveredCartLines, recoveredSyncEvents, storage, persistDenied: persisted === false } })
    track('app.booted', { mode: settings.apiMode, recoveredCartLines, recoveredSyncEvents })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    track('app.boot_failed', { message }, 'error')
    useBoot.setState({ status: 'failed', error: message })
  }
}
