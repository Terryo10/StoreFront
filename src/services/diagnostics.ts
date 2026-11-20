import { getApiConfig, integrationStatus } from '@/api'
import { getMockFault, mockDeliveredCount } from '@/api/mock'
import { db } from '@/db/schema'
import { getStorageStatus } from '@/lib/storage'
import { getTelemetry } from '@/lib/telemetry'
import { getBridge } from './bridge'
import { getSyncSnapshot } from './sync-engine'
import { tokenStorageKind } from './secure-token'

/** Support bundle. Contains no tokens or passwords. */
export async function buildDiagnostics(): Promise<string> {
  const [snapshot, meta, settings, session, outboxProblems, outboxRecent, conflicts, storage, shifts, tokenKind, appInfo] = await Promise.all([
    getSyncSnapshot(),
    db.syncMetadata.get('device'),
    db.settings.get('app'),
    db.session.get('session'),
    db.outbox.where('status').anyOf('rejected', 'conflict', 'pending', 'syncing').toArray(),
    db.outbox.orderBy('deviceSequence').reverse().limit(50).toArray(),
    db.conflicts.toArray(),
    getStorageStatus(),
    db.shifts.orderBy('openedAt').reverse().limit(5).toArray(),
    tokenStorageKind(),
    getBridge()?.appInfo().catch(() => null) ?? Promise.resolve(null),
  ])
  const counts = {
    products: await db.products.count(),
    sales: await db.sales.count(),
    heldSales: await db.heldSales.count(),
    countEvents: await db.countEvents.count(),
    outbox: await db.outbox.count(),
  }
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      api: { ...getApiConfig(), integrations: integrationStatus() },
      mock: getApiConfig().mode === 'mock' ? { fault: getMockFault(), distinctEventsDelivered: mockDeliveredCount() } : null,
      app: appInfo ?? { runtime: 'browser', userAgent: navigator.userAgent },
      tokenStorage: tokenKind,
      session: session ? { role: session.role, email: session.email, authMode: session.authMode } : null,
      settings: settings ? { ...settings } : null,
      syncMetadata: meta,
      snapshot,
      storage,
      counts,
      shifts: shifts.map((s) => ({ id: s.id, number: s.number, status: s.status, openedAt: s.openedAt, closedAt: s.closedAt, receiptSequence: s.receiptSequence, syncState: s.syncState })),
      outboxNeedingAttention: outboxProblems,
      outboxRecent: outboxRecent.map((e) => ({ ...e, payload: undefined })),
      conflicts,
      telemetry: getTelemetry(),
      note: 'Background Sync is not used. The till syncs in the foreground and on demand.',
    },
    null,
    2,
  )
}
