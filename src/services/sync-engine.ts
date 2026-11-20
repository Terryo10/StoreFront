import { ApiError, pushEvents } from '@/api'
import type { SyncPushRequest, SyncResult } from '@/api/types'
import { db } from '@/db/schema'
import type { ConflictRecord, OutboxEvent, SyncState } from '@/db/types'
import { createId } from '@/lib/ids'
import { track } from '@/lib/telemetry'

export const MAX_BATCH = 100
const MAX_BATCHES_PER_RUN = 50

let running: Promise<SyncRunResult> | null = null
const listeners = new Set<() => void>()

export function subscribeSyncEngine(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
const notify = () => listeners.forEach((l) => l())

export function isSyncRunning() {
  return running !== null
}

export interface SyncRunResult {
  attempted: number
  acknowledged: number
  rejected: number
  conflicts: number
  stoppedReason: null | 'auth' | 'network' | 'server' | 'nothing_due' | 'blocked'
  error: string | null
}

/** Exponential backoff with full jitter, capped at 5 minutes. */
export function backoffMs(attempt: number): number {
  const cap = Math.min(300_000, 1000 * 2 ** Math.min(attempt, 12))
  return Math.floor(cap / 2 + Math.random() * (cap / 2))
}

/**
 * Pushes due outbox events in batches of at most 100, ordered by device sequence.
 * Manual runs ignore backoff timers and clear an auth block for one attempt.
 */
export function syncNow(options: { manual?: boolean } = {}): Promise<SyncRunResult> {
  if (running) return running
  running = run(options).finally(() => {
    running = null
    notify()
  })
  notify()
  return running
}

async function run({ manual = false }: { manual?: boolean }): Promise<SyncRunResult> {
  const total: SyncRunResult = { attempted: 0, acknowledged: 0, rejected: 0, conflicts: 0, stoppedReason: null, error: null }
  const meta = await db.syncMetadata.get('device')
  if (meta?.authBlocked && !manual) {
    return { ...total, stoppedReason: 'blocked', error: meta.lastPushError }
  }

  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const batch = await nextBatch(manual)
    if (batch.length === 0) {
      if (total.attempted === 0) total.stoppedReason = 'nothing_due'
      break
    }
    const result = await pushBatch(batch)
    total.attempted += result.attempted
    total.acknowledged += result.acknowledged
    total.rejected += result.rejected
    total.conflicts += result.conflicts
    if (result.stoppedReason) {
      total.stoppedReason = result.stoppedReason
      total.error = result.error
      break
    }
    notify()
  }
  return total
}

async function nextBatch(ignoreBackoff: boolean): Promise<OutboxEvent[]> {
  const now = new Date().toISOString()
  const pending = await db.outbox.where('[status+deviceSequence]').between(['pending', 0], ['pending', Infinity]).toArray()
  return pending.filter((e) => ignoreBackoff || !e.nextAttemptAt || e.nextAttemptAt <= now).slice(0, MAX_BATCH)
}

function toWire(ev: OutboxEvent): SyncPushRequest['events'][number] {
  return {
    event_id: ev.id,
    device_id: ev.deviceId,
    device_sequence: ev.deviceSequence,
    event_type: ev.type,
    observed_at: ev.observedAt,
    payload: ev.payload,
  }
}

function errorParts(error: SyncResult['error']): { code: string; message: string } {
  if (!error) return { code: 'rejected', message: 'Rejected by server without a reason' }
  if (typeof error === 'string') return { code: 'rejected', message: error }
  return { code: error.code ?? 'rejected', message: error.message ?? 'Rejected by server' }
}

async function pushBatch(batch: OutboxEvent[]): Promise<SyncRunResult> {
  const result: SyncRunResult = { attempted: batch.length, acknowledged: 0, rejected: 0, conflicts: 0, stoppedReason: null, error: null }
  const startedAt = new Date().toISOString()

  await db.transaction('rw', [db.outbox, db.sales, db.shifts, db.countEvents, db.countExceptions, db.stocktakes, db.syncMetadata], async () => {
    for (const ev of batch) {
      await db.outbox.update(ev.id, { status: 'syncing', updatedAt: startedAt })
      await setEntitySyncState(ev, 'pending', null)
    }
    await db.syncMetadata.update('device', { lastPushAttemptAt: startedAt })
  })
  notify()

  try {
    const response = await pushEvents({ events: batch.map(toWire) })

    // Collapse duplicate results for the same event id; an acknowledgement wins over a rejection.
    const byId = new Map<string, SyncResult>()
    for (const r of response.results) {
      const prev = byId.get(r.event_id)
      if (!prev || (prev.status !== 'acknowledged' && r.status === 'acknowledged')) byId.set(r.event_id, r)
    }

    const now = new Date().toISOString()
    await db.transaction('rw', [db.outbox, db.sales, db.shifts, db.countEvents, db.countExceptions, db.stocktakes, db.syncMetadata, db.conflicts], async () => {
      for (const ev of batch) {
        const r = byId.get(ev.id)
        const attemptCount = ev.attemptCount + 1
        if (!r) {
          // Never infer success: an event missing from the response stays pending.
          await db.outbox.update(ev.id, {
            status: 'pending',
            attemptCount,
            lastError: 'Server response did not include this event',
            lastErrorCode: 'missing_result',
            nextAttemptAt: new Date(Date.now() + backoffMs(attemptCount)).toISOString(),
            updatedAt: now,
          })
          await setEntitySyncState(ev, 'pending', 'Awaiting server acknowledgement')
          continue
        }
        if (r.status === 'acknowledged') {
          result.acknowledged += 1
          await db.outbox.update(ev.id, {
            status: 'acknowledged',
            attemptCount,
            lastError: null,
            lastErrorCode: null,
            nextAttemptAt: null,
            acknowledgedAt: now,
            updatedAt: now,
          })
          await setEntitySyncState(ev, 'synced', null)
          continue
        }
        const { code, message } = errorParts(r.error)
        if (code === 'conflict') {
          result.conflicts += 1
          await markConflict(ev, attemptCount, code, message, now)
        } else {
          result.rejected += 1
          await db.outbox.update(ev.id, { status: 'rejected', attemptCount, lastError: message, lastErrorCode: code, nextAttemptAt: null, updatedAt: now })
          await setEntitySyncState(ev, 'rejected', message)
        }
      }
      if (result.acknowledged > 0) {
        await db.syncMetadata.update('device', { lastSuccessfulPushAt: now, lastPushError: null, authBlocked: false })
      }
    })
    track('sync.batch', { size: batch.length, acknowledged: result.acknowledged, rejected: result.rejected, conflicts: result.conflicts })
    return result
  } catch (err) {
    return handleBatchFailure(batch, err, result)
  }
}

async function handleBatchFailure(batch: OutboxEvent[], err: unknown, result: SyncRunResult): Promise<SyncRunResult> {
  const apiErr = err instanceof ApiError ? err : new ApiError(err instanceof Error ? err.message : 'Push failed', 0, 'network')
  const now = new Date().toISOString()
  track('sync.batch_failed', { status: apiErr.status, code: apiErr.code, message: apiErr.message }, 'warn')

  await db.transaction('rw', [db.outbox, db.sales, db.shifts, db.countEvents, db.countExceptions, db.stocktakes, db.syncMetadata, db.conflicts], async () => {
    for (const ev of batch) {
      const attemptCount = ev.attemptCount + 1
      if (apiErr.status === 401 || apiErr.status === 403) {
        // Keep events pending, but stop automatic retries until someone signs in or retries manually.
        await db.outbox.update(ev.id, { status: 'pending', attemptCount, lastError: apiErr.message, lastErrorCode: apiErr.code, nextAttemptAt: null, updatedAt: now })
        await setEntitySyncState(ev, 'pending', apiErr.message)
      } else if (apiErr.status === 409) {
        result.conflicts += 1
        await markConflict(ev, attemptCount, 'conflict', apiErr.message, now)
      } else if (apiErr.status === 422 || apiErr.status === 400) {
        result.rejected += 1
        await db.outbox.update(ev.id, { status: 'rejected', attemptCount, lastError: apiErr.message, lastErrorCode: apiErr.code, nextAttemptAt: null, updatedAt: now })
        await setEntitySyncState(ev, 'rejected', apiErr.message)
      } else {
        await db.outbox.update(ev.id, {
          status: 'pending',
          attemptCount,
          lastError: apiErr.message,
          lastErrorCode: apiErr.code,
          nextAttemptAt: new Date(Date.now() + backoffMs(attemptCount)).toISOString(),
          updatedAt: now,
        })
        await setEntitySyncState(ev, 'pending', apiErr.message)
      }
    }
    const authBlocked = apiErr.status === 401 || apiErr.status === 403
    await db.syncMetadata.update('device', { lastPushError: apiErr.message, ...(authBlocked ? { authBlocked: true } : {}) })
  })

  if (apiErr.status === 401 || apiErr.status === 403) return { ...result, stoppedReason: 'auth', error: apiErr.message }
  if (apiErr.status === 409 || apiErr.status === 422 || apiErr.status === 400) return { ...result, stoppedReason: 'server', error: apiErr.message }
  return { ...result, stoppedReason: apiErr.status === 0 ? 'network' : 'server', error: apiErr.message }
}

async function markConflict(ev: OutboxEvent, attemptCount: number, code: string, message: string, now: string) {
  await db.outbox.update(ev.id, { status: 'conflict', attemptCount, lastError: message, lastErrorCode: code, nextAttemptAt: null, updatedAt: now })
  await setEntitySyncState(ev, 'conflict', message)
  const existing = await db.conflicts.where('outboxEventId').equals(ev.id).filter((c) => c.resolvedAt === null).first()
  if (!existing) {
    const record: ConflictRecord = { id: createId(), outboxEventId: ev.id, eventType: ev.type, code, message, createdAt: now, resolvedAt: null, resolution: null }
    await db.conflicts.add(record)
  }
}

async function setEntitySyncState(ev: OutboxEvent, state: SyncState, error: string | null) {
  switch (ev.entityTable) {
    case 'sales':
      await db.sales.update(ev.entityId, { syncState: state, syncError: error })
      break
    case 'shifts': {
      // A shift has two events; show the state of the latest one.
      const shift = await db.shifts.get(ev.entityId)
      if (shift && (shift.closeEventId === null || shift.closeEventId === ev.id)) await db.shifts.update(ev.entityId, { syncState: state })
      break
    }
    case 'countEvents':
      await db.countEvents.update(ev.entityId, { syncState: state })
      break
    case 'countExceptions':
      await db.countExceptions.update(ev.entityId, { syncState: state })
      break
    case 'stocktakes':
      if (state === 'synced') await db.stocktakes.update(ev.entityId, { status: 'submitted', serverState: 'server-acknowledged' })
      break
  }
}

/** Puts a rejected or conflicted event back in the queue. The event id is unchanged, so the server can deduplicate. */
export async function requeueEvent(eventId: string): Promise<void> {
  const now = new Date().toISOString()
  await db.transaction('rw', [db.outbox, db.conflicts, db.sales, db.shifts, db.countEvents, db.countExceptions, db.stocktakes], async () => {
    const ev = await db.outbox.get(eventId)
    if (!ev || ev.status === 'acknowledged' || ev.status === 'syncing') return
    await db.outbox.update(eventId, { status: 'pending', nextAttemptAt: null, updatedAt: now })
    await setEntitySyncState(ev, 'pending', 'Re-queued manually')
    const open = await db.conflicts.where('outboxEventId').equals(eventId).filter((c) => c.resolvedAt === null).toArray()
    for (const c of open) await db.conflicts.update(c.id, { resolvedAt: now, resolution: 'requeued' })
  })
  notify()
}

export async function keepConflictForReview(conflictId: string): Promise<void> {
  await db.conflicts.update(conflictId, { resolvedAt: new Date().toISOString(), resolution: 'kept_for_review' })
  notify()
}

export async function clearAuthBlock(): Promise<void> {
  await db.syncMetadata.update('device', { authBlocked: false })
  notify()
}

/** Events left in `syncing` by a crash or power cut go back to pending. Run once at startup. */
export async function recoverInterruptedSync(): Promise<number> {
  const stuck = await db.outbox.where('status').equals('syncing').toArray()
  if (stuck.length === 0) return 0
  const now = new Date().toISOString()
  await db.outbox.bulkUpdate(stuck.map((e) => ({ key: e.id, changes: { status: 'pending' as const, updatedAt: now } })))
  track('sync.recovered_interrupted', { count: stuck.length }, 'warn')
  return stuck.length
}

export interface SyncSnapshot {
  local: number
  pending: number
  rejected: number
  conflicts: number
  acknowledged: number
  lastSuccessfulPushAt: string | null
  lastPushAttemptAt: string | null
  lastPushError: string | null
  authBlocked: boolean
}

export async function getSyncSnapshot(): Promise<SyncSnapshot> {
  const [meta, pendingEvents, rejected, conflicts, acknowledged] = await Promise.all([
    db.syncMetadata.get('device'),
    db.outbox.where('status').anyOf('pending', 'syncing').toArray(),
    db.outbox.where('status').equals('rejected').count(),
    db.outbox.where('status').equals('conflict').count(),
    db.outbox.where('status').equals('acknowledged').count(),
  ])
  const local = pendingEvents.filter((e) => e.attemptCount === 0 && e.status === 'pending').length
  return {
    local,
    pending: pendingEvents.length,
    rejected,
    conflicts,
    acknowledged,
    lastSuccessfulPushAt: meta?.lastSuccessfulPushAt ?? null,
    lastPushAttemptAt: meta?.lastPushAttemptAt ?? null,
    lastPushError: meta?.lastPushError ?? null,
    authBlocked: meta?.authBlocked ?? false,
  }
}
