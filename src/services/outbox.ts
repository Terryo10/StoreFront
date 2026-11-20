import Dexie from 'dexie'
import { db } from '@/db/schema'
import type { EntityTable, EventType, OutboxEvent } from '@/db/types'
import { createId } from '@/lib/ids'

/** Tables every caller must include in its Dexie transaction when appending an event. */
export const outboxTables = () => [db.outbox, db.syncMetadata]

/**
 * Appends an outbox event. Must be called inside a Dexie `rw` transaction that also
 * covers `outboxTables()`, so the device sequence increment and the event write
 * commit or roll back together with the business records.
 */
export async function appendOutboxEvent(input: {
  type: EventType
  payload: Record<string, unknown>
  entityTable: EntityTable
  entityId: string
  id?: string
  observedAt?: string
}): Promise<OutboxEvent> {
  if (!Dexie.currentTransaction) {
    throw new Error('appendOutboxEvent must run inside a Dexie transaction')
  }
  const meta = await db.syncMetadata.get('device')
  if (!meta) throw new Error('Device metadata missing; baseline not initialised')
  const deviceSequence = meta.deviceSequence + 1
  await db.syncMetadata.update('device', { deviceSequence })

  const now = new Date().toISOString()
  const event: OutboxEvent = {
    id: input.id ?? createId(),
    deviceId: meta.deviceId,
    deviceSequence,
    type: input.type,
    payload: input.payload,
    observedAt: input.observedAt ?? now,
    status: 'pending',
    attemptCount: 0,
    lastError: null,
    lastErrorCode: null,
    nextAttemptAt: null,
    entityTable: input.entityTable,
    entityId: input.entityId,
    createdAt: now,
    updatedAt: now,
    acknowledgedAt: null,
  }
  await db.outbox.add(event)
  return event
}
