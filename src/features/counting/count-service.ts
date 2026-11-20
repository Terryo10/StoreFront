import { fetchStocktakes, getApiConfig, startStocktakeRemote } from '@/api'
import { db } from '@/db/schema'
import type { CountEvent, CountException, Stocktake } from '@/db/types'
import { applyCountMode, dec, qty as qtyStr, type DecimalString } from '@/lib/decimal'
import { createId } from '@/lib/ids'
import type { Role } from '@/lib/permissions'
import { track } from '@/lib/telemetry'
import { appendOutboxEvent, outboxTables } from '@/services/outbox'
import { lookupBarcode } from '@/services/catalogue'
import type { Actor } from '@/features/sale/sale-service'

export const STOCKTAKE_STATUS_LABEL: Record<Stocktake['status'], string> = {
  assigned: 'Assigned to you',
  open: 'Open to any counter',
  counting: 'Counting in progress',
  submitted_local: 'Submitted on this device, server not confirmed',
  submitted: 'Submitted, server confirmed',
}

export async function listStocktakesFor(role: Role, userId: string): Promise<Stocktake[]> {
  const all = await db.stocktakes.toArray()
  return all
    .filter((s) => role !== 'counter' || s.assignedTo === null || s.assignedTo === 'counter' || s.assignedTo === userId)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Live mode: merge server assignments. Expected quantities are never accepted for blind counts. */
export async function refreshStocktakes(): Promise<{ ok: boolean; message: string }> {
  if (getApiConfig().mode === 'mock') return { ok: true, message: 'Mock mode: demo stocktakes' }
  try {
    const remote = await fetchStocktakes()
    if (!remote) return { ok: true, message: 'No stocktakes' }
    await db.transaction('rw', db.stocktakes, async () => {
      for (const r of remote) {
        const local = await db.stocktakes.get(r.id)
        if (local && (local.status === 'submitted_local' || local.status === 'counting')) continue
        await db.stocktakes.put({
          id: r.id,
          name: r.name,
          locationName: r.location_name ?? '',
          blind: r.blind,
          status: r.assigned_to ? 'assigned' : 'open',
          assignedTo: r.assigned_to == null ? null : String(r.assigned_to),
          expected: null,
          createdAt: local?.createdAt ?? new Date().toISOString(),
          submittedAt: null,
          submitEventId: null,
          serverState: 'local-only',
          source: 'server',
        })
      }
    })
    return { ok: true, message: `Loaded ${remote.length} stocktakes` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not load stocktakes' }
  }
}

export async function startCounting(stocktakeId: string): Promise<{ remoteStarted: boolean; note: string | null }> {
  await db.stocktakes.update(stocktakeId, { status: 'counting' })
  if (getApiConfig().mode === 'mock') return { remoteStarted: false, note: null }
  try {
    await startStocktakeRemote(stocktakeId)
    return { remoteStarted: true, note: null }
  } catch (err) {
    return { remoteStarted: false, note: `Started on this device only; the server was not told (${err instanceof Error ? err.message : 'error'}).` }
  }
}

export type RecordOutcome = { kind: 'counted'; event: CountEvent; productName: string } | { kind: 'exception'; exception: CountException }

export async function recordCount(input: { stocktakeId: string; barcode: string; quantity: DecimalString; mode: 'add' | 'replace'; counter: Actor }): Promise<RecordOutcome> {
  if (dec(input.quantity).isNegative()) throw new Error('Quantity cannot be negative')
  const product = await lookupBarcode(input.barcode)
  const observedAt = new Date().toISOString()

  if (!product) {
    const exception: CountException = {
      id: createId(),
      stocktakeId: input.stocktakeId,
      barcode: input.barcode.trim(),
      quantity: qtyStr(input.quantity),
      observedAt,
      counterId: input.counter.id,
      outboxEventId: createId(),
      syncState: 'local',
    }
    await db.transaction('rw', [db.countExceptions, ...outboxTables()], async () => {
      await db.countExceptions.add(exception)
      await appendOutboxEvent({
        id: exception.outboxEventId,
        type: 'stocktake.exception.recorded',
        entityTable: 'countExceptions',
        entityId: exception.id,
        observedAt,
        payload: { stocktake_id: input.stocktakeId, barcode: exception.barcode, product_id: null, quantity: exception.quantity, observed_at: observedAt, counter_id: input.counter.id },
      })
    })
    track('count.exception', { barcode: exception.barcode })
    return { kind: 'exception', exception }
  }

  const event = await db.transaction('rw', [db.countEvents, ...outboxTables()], async () => {
    const current = await localCountFor(input.stocktakeId, product.id)
    const ev: CountEvent = {
      id: createId(),
      stocktakeId: input.stocktakeId,
      productId: product.id,
      barcode: input.barcode.trim(),
      quantity: qtyStr(input.quantity),
      mode: input.mode,
      resultingQty: applyCountMode(current, input.quantity, input.mode),
      correctsEventId: null,
      observedAt,
      counterId: input.counter.id,
      syncState: 'local',
    }
    await db.countEvents.add(ev)
    await appendOutboxEvent({ id: ev.id, type: 'stocktake.count.recorded', entityTable: 'countEvents', entityId: ev.id, observedAt, payload: countPayload(ev) })
    return ev
  })
  return { kind: 'counted', event, productName: product.name }
}

/** Corrections never edit history: they append a new `replace` event that references the old one. */
export async function recordCorrection(input: { eventId: string; quantity: DecimalString; counter: Actor }): Promise<CountEvent> {
  const original = await db.countEvents.get(input.eventId)
  if (!original || !original.productId) throw new Error('Count event not found')
  const observedAt = new Date().toISOString()
  return db.transaction('rw', [db.countEvents, ...outboxTables()], async () => {
    const ev: CountEvent = {
      ...original,
      id: createId(),
      quantity: qtyStr(input.quantity),
      mode: 'replace',
      resultingQty: qtyStr(input.quantity),
      correctsEventId: original.id,
      observedAt,
      counterId: input.counter.id,
      syncState: 'local',
    }
    await db.countEvents.add(ev)
    await appendOutboxEvent({ id: ev.id, type: 'stocktake.count.recorded', entityTable: 'countEvents', entityId: ev.id, observedAt, payload: countPayload(ev) })
    return ev
  })
}

function countPayload(ev: CountEvent) {
  return {
    stocktake_id: ev.stocktakeId,
    product_id: ev.productId,
    barcode: ev.barcode,
    quantity: ev.quantity,
    mode: ev.mode,
    corrects_event_id: ev.correctsEventId,
    observed_at: ev.observedAt,
    counter_id: ev.counterId,
  }
}

async function localCountFor(stocktakeId: string, productId: string): Promise<DecimalString | null> {
  const events = await db.countEvents.where('[stocktakeId+productId]').equals([stocktakeId, productId]).sortBy('observedAt')
  return events.length ? events[events.length - 1].resultingQty : null
}

export async function countSummary(stocktakeId: string) {
  const [events, exceptions] = await Promise.all([
    db.countEvents.where('stocktakeId').equals(stocktakeId).sortBy('observedAt'),
    db.countExceptions.where('stocktakeId').equals(stocktakeId).toArray(),
  ])
  const latest = new Map<string, CountEvent>()
  for (const e of events) if (e.productId) latest.set(e.productId, e)
  return { events, exceptions, productsCounted: latest.size, latest }
}

/** Submitting is local until the server acknowledges the `stocktake.submitted` event. */
export async function submitStocktake(stocktakeId: string, actor: Actor): Promise<Stocktake> {
  const at = new Date().toISOString()
  return db.transaction('rw', [db.stocktakes, db.countEvents, db.countExceptions, ...outboxTables()], async () => {
    const st = await db.stocktakes.get(stocktakeId)
    if (!st) throw new Error('Stocktake not found')
    if (st.status === 'submitted_local' || st.status === 'submitted') throw new Error('This stocktake was already submitted')
    const eventCount = await db.countEvents.where('stocktakeId').equals(stocktakeId).count()
    const exceptionCount = await db.countExceptions.where('stocktakeId').equals(stocktakeId).count()
    const eventId = createId()
    await appendOutboxEvent({
      id: eventId,
      type: 'stocktake.submitted',
      entityTable: 'stocktakes',
      entityId: stocktakeId,
      observedAt: at,
      payload: { stocktake_id: stocktakeId, submitted_by: actor.id, submitted_at: at, count_event_total: eventCount, exception_total: exceptionCount },
    })
    const next: Stocktake = { ...st, status: 'submitted_local', submittedAt: at, submitEventId: eventId, serverState: 'local-only' }
    await db.stocktakes.put(next)
    return next
  })
}
