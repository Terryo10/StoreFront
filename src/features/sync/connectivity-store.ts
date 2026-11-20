import { create } from 'zustand'
import { probeServer } from '@/api'
import { getSyncSnapshot, isSyncRunning, subscribeSyncEngine, syncNow, type SyncRunResult, type SyncSnapshot } from '@/services/sync-engine'

export type Reachability = 'checking' | 'online' | 'offline'

interface ConnectivityState {
  reachability: Reachability
  detail: string
  latencyMs: number | null
  lastProbeAt: string | null
  syncing: boolean
  snapshot: SyncSnapshot | null
  lastRun: SyncRunResult | null
  probe: () => Promise<boolean>
  refresh: () => Promise<void>
  sync: (manual?: boolean) => Promise<SyncRunResult | null>
}

export const useConnectivity = create<ConnectivityState>((set, get) => ({
  reachability: 'checking',
  detail: 'Checking server…',
  latencyMs: null,
  lastProbeAt: null,
  syncing: false,
  snapshot: null,
  lastRun: null,

  probe: async () => {
    const r = await probeServer()
    set({ reachability: r.reachable ? 'online' : 'offline', detail: r.detail, latencyMs: r.latencyMs, lastProbeAt: new Date().toISOString() })
    return r.reachable
  },

  refresh: async () => {
    set({ snapshot: await getSyncSnapshot(), syncing: isSyncRunning() })
  },

  sync: async (manual = false) => {
    const reachable = await get().probe()
    if (!reachable && !manual) return null
    const result = await syncNow({ manual })
    set({ lastRun: result })
    await get().refresh()
    return result
  },
}))

const FOREGROUND_INTERVAL_MS = 20_000

/**
 * Foreground sync loop. Background Sync is not relied on: the till pushes while it is open,
 * on an interval, when the window regains focus, and when the OS reports a network change.
 */
export function startSyncLoop(): () => void {
  const store = useConnectivity.getState
  const unsub = subscribeSyncEngine(() => void store().refresh())
  const tick = () => {
    if (document.visibilityState === 'visible') void store().sync(false)
  }
  const timer = window.setInterval(tick, FOREGROUND_INTERVAL_MS)
  const onVisible = () => document.visibilityState === 'visible' && tick()
  window.addEventListener('online', tick)
  window.addEventListener('offline', () => void store().probe())
  document.addEventListener('visibilitychange', onVisible)
  void store().refresh()
  tick()
  return () => {
    unsub()
    window.clearInterval(timer)
    window.removeEventListener('online', tick)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
