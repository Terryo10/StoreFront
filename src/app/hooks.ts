import { db } from '@/db/schema'
import type { Shift } from '@/db/types'
import { useLive } from '@/lib/use-live'
import { getSyncSnapshot, type SyncSnapshot } from '@/services/sync-engine'

/** `undefined` while loading, `null` when no shift is open. */
export function useOpenShift(): Shift | null | undefined {
  return useLive(async () => (await db.shifts.where('status').equals('open').first()) ?? null, [])
}

export function useSyncSnapshot(): SyncSnapshot | undefined {
  return useLive(() => getSyncSnapshot(), [])
}

export function useSyncMeta() {
  return useLive(() => db.syncMetadata.get('device'), [])
}
