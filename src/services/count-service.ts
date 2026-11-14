import type { CountEvent, CountMode } from '@/domain/types'
import { db, type OutboxEvent } from '@/db/schema'
import { applyCountMode, qtyString } from '@/lib/decimal'
import { createId, getOrCreateDeviceId } from '@/lib/ids'

export interface RecordCountInput {
  stocktakeId: string
  productId: string
  locationId: string
  quantity: string
  mode: CountMode
  baseVersion?: number | null
}

/**
 * Persist a count locally BEFORE any success UI.
 * Atomically: bump device sequence, append count event, update count view + line, enqueue outbox.
 */
export async function recordCount(input: RecordCountInput): Promise<{
  event: CountEvent
  outbox: OutboxEvent
  displayQty: string
}> {
  const deviceId = getOrCreateDeviceId()
  const observedAt = new Date().toISOString()
  const quantity = qtyString(input.quantity)

  return db.transaction(
    'rw',
    db.syncMetadata,
    db.countEvents,
    db.countViews,
    db.stocktakeLines,
    db.outbox,
    async () => {
      const meta = await db.syncMetadata.get('device')
      if (!meta) throw new Error('Device sync metadata missing')

      const nextSeq = meta.deviceSequence + 1
      const eventId = createId()
      const viewId = `${input.stocktakeId}:${input.productId}:${input.locationId}`

      const existingView = await db.countViews.get(viewId)
      const displayQty = applyCountMode(existingView?.quantity ?? null, quantity, input.mode)

      const event: CountEvent = {
        id: eventId,
        deviceId,
        deviceSequence: nextSeq,
        eventType: 'stocktake.count.recorded',
        stocktakeId: input.stocktakeId,
        productId: input.productId,
        locationId: input.locationId,
        quantity,
        mode: input.mode,
        observedAt,
        baseVersion: input.baseVersion ?? null,
        syncStatus: 'pending',
        attemptCount: 0,
        lastError: null,
        origin: 'device',
      }

      const outbox: OutboxEvent = {
        id: eventId,
        deviceId,
        deviceSequence: nextSeq,
        eventType: 'stocktake.count.recorded',
        stocktakeId: input.stocktakeId,
        productId: input.productId,
        locationId: input.locationId,
        quantity,
        mode: input.mode,
        observedAt,
        baseVersion: input.baseVersion ?? null,
        status: 'pending',
        attemptCount: 0,
        lastError: null,
        nextAttemptAt: observedAt,
        createdAt: observedAt,
        updatedAt: observedAt,
      }

      await db.syncMetadata.update('device', { deviceSequence: nextSeq })
      await db.countEvents.put(event)
      await db.countViews.put({
        id: viewId,
        stocktakeId: input.stocktakeId,
        productId: input.productId,
        locationId: input.locationId,
        quantity: displayQty,
        lastEventId: eventId,
        updatedAt: observedAt,
        syncStatus: 'pending',
      })

      const line = await db.stocktakeLines
        .where({ stocktakeId: input.stocktakeId, productId: input.productId })
        .first()
      if (line) {
        await db.stocktakeLines.update(line.id, {
          countedQty: displayQty,
          countEventCount: line.countEventCount + 1,
        })
      }

      await db.outbox.put(outbox)
      return { event, outbox, displayQty }
    },
  )
}

export async function holdUnknownBarcode(stocktakeId: string, code: string, note?: string) {
  const id = createId()
  await db.unknownBarcodes.put({
    id,
    code,
    stocktakeId,
    observedAt: new Date().toISOString(),
    note: note ?? null,
    status: 'held',
  })
  return id
}

export async function lookupLocalProductByBarcode(code: string) {
  const barcode = await db.barcodes.where('code').equals(code).first()
  if (!barcode) return null
  const product = await db.products.get(barcode.productId)
  return product ?? null
}
