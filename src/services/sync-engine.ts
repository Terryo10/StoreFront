import { ApiError } from '@/api/client'
import { pullSync, pushSync } from '@/api'
import { db, type OutboxEvent } from '@/db/schema'
import type { SyncEnvelope, SyncPushEvent, SyncVisualStatus } from '@/domain/types'

const MAX_BATCH = 100
const MAX_ATTEMPTS_AUTH = 1
let syncing = false
const listeners = new Set<() => void>()

export function subscribeSync(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify() {
  listeners.forEach((l) => l())
}

function backoffMs(attempt: number) {
  const base = Math.min(60_000, 500 * 2 ** attempt)
  return base + Math.floor(Math.random() * 250)
}

function toPushEvent(ev: OutboxEvent): SyncPushEvent {
  return {
    event_id: ev.id,
    device_id: ev.deviceId,
    device_sequence: ev.deviceSequence,
    event_type: 'stocktake.count.recorded',
    payload: {
      stocktake_id: ev.stocktakeId,
      product_id: ev.productId,
      quantity: ev.quantity,
      mode: ev.mode,
      observed_at: ev.observedAt,
    },
  }
}

async function markEventStatus(
  eventId: string,
  status: SyncVisualStatus,
  lastError: string | null,
) {
  await db.countEvents.update(eventId, { syncStatus: status, lastError })
  const view = await db.countViews.where('lastEventId').equals(eventId).first()
  if (view) await db.countViews.update(view.id, { syncStatus: status })
}

/**
 * Process pending outbox with deterministic retry, max batch 100.
 * Never drops rejected events. Does not retry auth errors indefinitely.
 * On success, only marks exact acknowledged event IDs.
 */
export async function processOutbox(options?: { force?: boolean }): Promise<{
  processed: number
  acknowledged: number
  rejected: number
  conflicts: number
  error?: string
}> {
  if (syncing) {
    return { processed: 0, acknowledged: 0, rejected: 0, conflicts: 0, error: 'Sync already running' }
  }
  syncing = true
  notify()

  let acknowledged = 0
  let rejected = 0
  let conflicts = 0
  let processed = 0

  try {
    const now = new Date().toISOString()
    const pending = await db.outbox
      .where('status')
      .anyOf(['pending', 'rejected', 'conflict'])
      .toArray()

    const due = pending
      .filter((e) => {
        if (options?.force) return e.status === 'pending' || e.status === 'rejected' || e.status === 'conflict'
        if (e.status !== 'pending') return false
        return !e.nextAttemptAt || e.nextAttemptAt <= now
      })
      .sort((a, b) => a.deviceSequence - b.deviceSequence)
      .slice(0, MAX_BATCH)

    if (due.length === 0) {
      return { processed: 0, acknowledged: 0, rejected: 0, conflicts: 0 }
    }

    await Promise.all(
      due.map((e) => db.outbox.update(e.id, { status: 'syncing', updatedAt: new Date().toISOString() })),
    )

    const envelope: SyncEnvelope = { events: due.map(toPushEvent) }

    try {
      const response = await pushSync(envelope)
      const byId = new Map(response.results.map((r) => [r.event_id, r]))

      for (const ev of due) {
        processed += 1
        const result = byId.get(ev.id)
        if (!result) {
          // Server did not acknowledge this exact event — keep pending, do not mark synced
          await db.outbox.update(ev.id, {
            status: 'pending',
            attemptCount: ev.attemptCount + 1,
            lastError: 'No result for event_id in push response',
            nextAttemptAt: new Date(Date.now() + backoffMs(ev.attemptCount + 1)).toISOString(),
            updatedAt: new Date().toISOString(),
          })
          await markEventStatus(ev.id, 'pending', 'No result for event_id')
          continue
        }

        if (result.status === 'acknowledged') {
          acknowledged += 1
          await db.outbox.update(ev.id, {
            status: 'acknowledged',
            attemptCount: ev.attemptCount + 1,
            lastError: null,
            nextAttemptAt: null,
            updatedAt: new Date().toISOString(),
          })
          await markEventStatus(ev.id, 'synced', null)
          await db.syncMetadata.update('device', {
            lastSuccessfulPushAt: new Date().toISOString(),
            lastAckDeviceSequence: ev.deviceSequence,
          })
        } else {
          const code = result.error?.code ?? 'rejected'
          const message = result.error?.message ?? 'Rejected by server'
          const isConflict = code === 'conflict' || code.includes('409')
          if (isConflict) {
            conflicts += 1
            await db.outbox.update(ev.id, {
              status: 'conflict',
              attemptCount: ev.attemptCount + 1,
              lastError: message,
              nextAttemptAt: null,
              updatedAt: new Date().toISOString(),
            })
            await markEventStatus(ev.id, 'conflict', message)
            await db.conflicts.put({
              id: crypto.randomUUID(),
              outboxEventId: ev.id,
              stocktakeId: ev.stocktakeId,
              productId: ev.productId,
              code,
              message,
              createdAt: new Date().toISOString(),
              resolvedAt: null,
              resolution: null,
            })
          } else {
            rejected += 1
            await db.outbox.update(ev.id, {
              status: 'rejected',
              attemptCount: ev.attemptCount + 1,
              lastError: message,
              nextAttemptAt: null,
              updatedAt: new Date().toISOString(),
            })
            await markEventStatus(ev.id, 'rejected', message)
          }
        }
      }
    } catch (err) {
      const status = err instanceof ApiError ? err.status : (err as { status?: number })?.status
      const message = err instanceof Error ? err.message : 'Push failed'

      for (const ev of due) {
        const auth = status === 401 || status === 403
        const conflict = status === 409
        if (auth) {
          await db.outbox.update(ev.id, {
            status: 'rejected',
            attemptCount: Math.max(ev.attemptCount + 1, MAX_ATTEMPTS_AUTH),
            lastError: `Authorization error: ${message}`,
            nextAttemptAt: null,
            updatedAt: new Date().toISOString(),
          })
          await markEventStatus(ev.id, 'rejected', message)
          rejected += 1
        } else if (conflict) {
          await db.outbox.update(ev.id, {
            status: 'conflict',
            attemptCount: ev.attemptCount + 1,
            lastError: message,
            nextAttemptAt: null,
            updatedAt: new Date().toISOString(),
          })
          await markEventStatus(ev.id, 'conflict', message)
          conflicts += 1
        } else {
          const attempt = ev.attemptCount + 1
          await db.outbox.update(ev.id, {
            status: 'pending',
            attemptCount: attempt,
            lastError: message,
            nextAttemptAt: new Date(Date.now() + backoffMs(attempt)).toISOString(),
            updatedAt: new Date().toISOString(),
          })
          await markEventStatus(ev.id, 'pending', message)
        }
        processed += 1
      }

      return { processed, acknowledged, rejected, conflicts, error: message }
    }

    return { processed, acknowledged, rejected, conflicts }
  } finally {
    syncing = false
    notify()
  }
}

export async function attemptPull() {
  const result = await pullSync(null)
  await db.syncMetadata.update('device', {
    lastPullAttemptAt: new Date().toISOString(),
    lastPullDetail: result.message,
    pullAvailable: result.implemented,
  })
  notify()
  return result
}

export async function getSyncSnapshot() {
  const meta = await db.syncMetadata.get('device')
  const pending = await db.outbox.where('status').equals('pending').count()
  const rejected = await db.outbox.where('status').equals('rejected').count()
  const conflicts = await db.outbox.where('status').equals('conflict').count()
  const acknowledged = await db.outbox.where('status').equals('acknowledged').count()
  return {
    deviceId: meta?.deviceId ?? null,
    deviceSequence: meta?.deviceSequence ?? 0,
    lastSuccessfulPushAt: meta?.lastSuccessfulPushAt ?? null,
    lastAckDeviceSequence: meta?.lastAckDeviceSequence ?? null,
    lastPullAttemptAt: meta?.lastPullAttemptAt ?? null,
    lastPullDetail: meta?.lastPullDetail ?? null,
    pullAvailable: meta?.pullAvailable ?? false,
    pending,
    rejected,
    conflicts,
    acknowledged,
    syncing,
  }
}

export async function exportDiagnostics(): Promise<string> {
  const [snapshot, outbox, conflicts, settings, session] = await Promise.all([
    getSyncSnapshot(),
    db.outbox.toArray(),
    db.conflicts.toArray(),
    db.settings.get('app'),
    db.session.get('session'),
  ])
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      snapshot,
      settings: settings
        ? { ...settings, /* no secrets beyond mock token presence */ }
        : null,
      session: session
        ? { role: session.role, email: session.email, authMode: session.authMode }
        : null,
      outbox,
      conflicts,
      note: 'Background Sync is not assumed. Foreground/manual sync is mandatory.',
    },
    null,
    2,
  )
}

export function isSyncing() {
  return syncing
}
