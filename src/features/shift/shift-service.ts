import { db } from '@/db/schema'
import type { CurrencyAmounts, Shift } from '@/db/types'
import { CURRENCIES, type CurrencyCode } from '@/lib/currency'
import { add, dec, money, type DecimalString } from '@/lib/decimal'
import { createId } from '@/lib/ids'
import { track } from '@/lib/telemetry'
import { appendOutboxEvent, outboxTables } from '@/services/outbox'
import type { Actor } from '@/features/sale/sale-service'

export async function getOpenShift(): Promise<Shift | undefined> {
  return db.shifts.where('status').equals('open').first()
}

export async function openShift(input: { cashier: Actor; float: CurrencyAmounts; exchangeRate: DecimalString; tillCode: string }): Promise<Shift> {
  if (dec(input.exchangeRate).lessThanOrEqualTo(0)) throw new Error('Enter a ZiG exchange rate greater than zero')
  const openedAt = new Date().toISOString()
  const id = createId()
  const eventId = createId()
  const openingFloat: CurrencyAmounts = Object.fromEntries(Object.entries(input.float).map(([c, v]) => [c, money(v)]))

  const shift = await db.transaction('rw', [db.shifts, ...outboxTables()], async () => {
    if (await db.shifts.where('status').equals('open').first()) throw new Error('A shift is already open on this till')
    const meta = await db.syncMetadata.get('device')
    if (!meta) throw new Error('Device metadata missing')
    const number = meta.shiftCounter + 1
    await db.syncMetadata.update('device', { shiftCounter: number })
    const record: Shift = {
      id,
      number,
      deviceId: meta.deviceId,
      tillCode: input.tillCode,
      cashierId: input.cashier.id,
      cashierName: input.cashier.name,
      status: 'open',
      openedAt,
      closedAt: null,
      exchangeRate: money(input.exchangeRate, 4),
      openingFloat,
      countedCash: null,
      expectedCash: null,
      receiptSequence: 0,
      openEventId: eventId,
      closeEventId: null,
      syncState: 'local',
    }
    await db.shifts.add(record)
    await appendOutboxEvent({
      id: eventId,
      type: 'shift.opened',
      entityTable: 'shifts',
      entityId: id,
      observedAt: openedAt,
      payload: {
        shift_id: id,
        shift_number: number,
        till_code: input.tillCode,
        cashier_id: input.cashier.id,
        opened_at: openedAt,
        opening_float: openingFloat,
        exchange_rates: { ZWG: record.exchangeRate },
      },
    })
    return record
  })
  track('shift.opened', { number: shift.number })
  return shift
}

/** Expected cash per currency: float + cash taken − change given − cash refunded. */
export async function computeExpectedCash(shift: Shift): Promise<CurrencyAmounts> {
  const sales = await db.sales.where('shiftId').equals(shift.id).toArray()
  const totals: Record<string, DecimalString> = {}
  for (const code of Object.keys(CURRENCIES) as CurrencyCode[]) totals[code] = money(shift.openingFloat[code] ?? '0')

  for (const sale of sales) {
    const payments = await db.payments.where('saleId').equals(sale.id).toArray()
    for (const p of payments) {
      if (p.method !== 'cash') continue
      totals[p.currency] = money(add(totals[p.currency], p.amount))
    }
    if (sale.kind === 'sale' && dec(sale.changeDue).greaterThan(0)) {
      totals[sale.changeCurrency] = money(dec(totals[sale.changeCurrency]).minus(dec(sale.changeDue)))
    }
  }
  return totals
}

export function cashVariance(expected: CurrencyAmounts, counted: CurrencyAmounts): CurrencyAmounts {
  const out: CurrencyAmounts = {}
  for (const code of Object.keys(CURRENCIES) as CurrencyCode[]) {
    out[code] = money(dec(counted[code] ?? '0').minus(dec(expected[code] ?? '0')))
  }
  return out
}

/**
 * Blind close: the counted cash is committed first, and expected figures are computed and
 * stored in the same transaction. The UI only reveals them after this resolves.
 */
export async function closeShift(input: { shiftId: string; counted: CurrencyAmounts; actor: Actor }): Promise<Shift> {
  const pre = await db.shifts.get(input.shiftId)
  if (!pre || pre.status !== 'open') throw new Error('This shift is not open')
  const held = await db.heldSales.where('shiftId').equals(pre.id).count()
  if (held > 0) throw new Error(`Resume or clear ${held} held sale(s) before closing the shift`)
  const active = await db.activeCart.get('current')
  if (active && active.lines.length > 0) throw new Error('Finish or clear the sale in progress before closing the shift')

  const expected = await computeExpectedCash(pre)
  const counted: CurrencyAmounts = Object.fromEntries(Object.entries(input.counted).map(([c, v]) => [c, money(v)]))
  const closedAt = new Date().toISOString()
  const eventId = createId()

  const closed = await db.transaction('rw', [db.shifts, ...outboxTables()], async () => {
    const shift = await db.shifts.get(input.shiftId)
    if (!shift || shift.status !== 'open') throw new Error('This shift is not open')
    const next: Shift = { ...shift, status: 'closed', closedAt, countedCash: counted, expectedCash: expected, closeEventId: eventId, syncState: 'local' }
    await db.shifts.put(next)
    await appendOutboxEvent({
      id: eventId,
      type: 'shift.closed',
      entityTable: 'shifts',
      entityId: shift.id,
      observedAt: closedAt,
      payload: {
        shift_id: shift.id,
        closed_at: closedAt,
        closed_by: input.actor.id,
        receipt_count: shift.receiptSequence,
        counted_cash: counted,
        expected_cash: expected,
        variance: cashVariance(expected, counted),
      },
    })
    return next
  })
  track('shift.closed', { number: closed.number })
  return closed
}
