import { db } from '@/db/schema'
import type { ActiveCart, AuditEntry, Cart, CartLine, CurrencyAmounts, HeldSale, Payment, Sale, SaleLine, Shift } from '@/db/types'
import { BASE_CURRENCY } from '@/lib/currency'
import { dec, money, roundToStep } from '@/lib/decimal'
import { allocateZigAmounts, receiptCurrencyOf } from '@/services/receipt-model'
import { createId, formatReceiptNumber } from '@/lib/ids'
import { track } from '@/lib/telemetry'
import { appendOutboxEvent, outboxTables } from '@/services/outbox'
import { fiscalAfterCommit, fiscalPrepare } from '@/services/fiscal'
import { summarisePayments, type Rates, type TenderLine } from '@/features/payments/payment-math'
import { cartTotals, lineTotal } from './cart-math'

export interface Actor {
  id: string
  name: string
}

export const EMPTY_CART: Cart = { lines: [], voided: [], startedAt: null }

export function sumByCurrency(payments: Array<Pick<Payment, 'currency' | 'amount'>>): CurrencyAmounts {
  const out: CurrencyAmounts = {}
  for (const p of payments) out[p.currency] = money(dec(out[p.currency] ?? '0').plus(dec(p.amount)))
  return out
}

export function shiftRates(shift: Pick<Shift, 'exchangeRate'>): Rates {
  return { USD: '1', ZWG: shift.exchangeRate }
}

export class SaleCommitError extends Error {}

/**
 * Completes a sale. The sale, its lines, its payments, the outbox event, the receipt
 * sequence bump and clearing the in-progress cart all commit in ONE IndexedDB transaction.
 * Callers must show success only after this promise resolves.
 */
export async function completeSale(input: { cart: Cart; tenders: TenderLine[]; shiftId: string; cashier: Actor }): Promise<Sale> {
  const { cart, tenders, cashier } = input
  if (cart.lines.length === 0) throw new SaleCommitError('The cart is empty')

  const shiftPeek = await db.shifts.get(input.shiftId)
  if (!shiftPeek || shiftPeek.status !== 'open') throw new SaleCommitError('No open shift on this till')

  const totals = cartTotals(cart)
  const rates = shiftRates(shiftPeek)
  const summary = summarisePayments(totals.total, tenders, rates)
  if (summary.error) throw new SaleCommitError(summary.error)
  if (!summary.settled) throw new SaleCommitError('The sale is not fully paid')

  const saleId = createId()
  const eventId = createId()
  const completedAt = new Date().toISOString()
  const peekReceipt = formatReceiptNumber(shiftPeek.tillCode, shiftPeek.number, shiftPeek.receiptSequence + 1)

  const settings = await db.settings.get('app')
  const step = settings?.zigRoundingStep && dec(settings.zigRoundingStep).greaterThan(0) ? settings.zigRoundingStep : '0.05'
  const rate = shiftPeek.exchangeRate
  const draftLines: SaleLine[] = cart.lines.map((l, i) => ({
    id: l.id,
    saleId,
    lineNo: i + 1,
    productId: l.productId,
    sku: l.sku,
    name: l.name,
    unit: l.unit,
    qty: l.qty,
    unitPrice: l.unitPrice,
    discount: l.discount,
    lineTotal: lineTotal(l),
    zigUnitPrice: '0.00',
    zigAmount: '0.00',
    zigDiscount: '0.00',
    discountApprovedBy: l.discountApprovedBy,
    originalLineId: null,
  }))
  const allocated = allocateZigAmounts(draftLines.map((l) => l.lineTotal), totals.total, rate, step)
  const lines: SaleLine[] = draftLines.map((l, i) => ({
    ...l,
    zigUnitPrice: roundToStep(dec(l.unitPrice).mul(dec(rate)), step),
    zigAmount: allocated.amounts[i] ?? '0.00',
    zigDiscount: dec(l.discount).isZero() ? '0.00' : roundToStep(dec(l.discount).mul(dec(rate)), step),
  }))
  const payments: Payment[] = tenders.map((t) => ({
    id: t.id,
    saleId,
    method: t.method,
    currency: t.currency,
    amount: t.amount,
    rate: t.rate,
    baseAmount: t.baseAmount,
    reference: t.reference,
    createdAt: completedAt,
  }))
  const tendered = sumByCurrency(payments)

  const fiscal = await fiscalPrepare({ kind: 'sale', receiptNumber: peekReceipt, total: totals.total, currency: BASE_CURRENCY, lines })

  const sale = await db.transaction('rw', [db.sales, db.saleLines, db.payments, db.shifts, db.activeCart, ...outboxTables()], async () => {
    const shift = await db.shifts.get(input.shiftId)
    if (!shift || shift.status !== 'open') throw new SaleCommitError('The shift was closed before the sale could be saved')
    const sequence = shift.receiptSequence + 1
    const receiptNumber = formatReceiptNumber(shift.tillCode, shift.number, sequence)
    if (fiscal && receiptNumber !== peekReceipt) throw new SaleCommitError('Receipt sequence changed during fiscal preparation; try again')

    const record: Sale = {
      id: saleId,
      kind: 'sale',
      receiptNumber,
      originalSaleId: null,
      originalReceiptNumber: null,
      shiftId: shift.id,
      deviceId: shift.deviceId,
      cashierId: cashier.id,
      cashierName: cashier.name,
      currency: BASE_CURRENCY,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      total: totals.total,
      baseTotalUsd: totals.total,
      receiptCurrency: receiptCurrencyOf(payments.map((p) => p.currency)),
      rateSnapshot: rate,
      zigTotal: allocated.zigTotal,
      zigRoundingStep: step,
      tendered,
      paidBase: summary.paidBase,
      changeDue: summary.changeDue,
      changeCurrency: summary.changeCurrency,
      exchangeRate: shift.exchangeRate,
      refundReason: null,
      approvedBy: null,
      completedAt,
      outboxEventId: eventId,
      syncState: 'local',
      syncError: null,
      printStatus: 'not_printed',
      printCount: 0,
      lastPrintError: null,
      fiscal,
    }

    await db.shifts.update(shift.id, { receiptSequence: sequence })
    await db.sales.add(record)
    await db.saleLines.bulkAdd(lines)
    await db.payments.bulkAdd(payments)
    await appendOutboxEvent({
      id: eventId,
      type: 'sale.completed',
      entityTable: 'sales',
      entityId: saleId,
      observedAt: completedAt,
      payload: saleCompletedPayload(record, lines, payments, cart),
    })
    await db.activeCart.delete('current')
    return record
  })

  track('sale.completed', { receipt: sale.receiptNumber, total: sale.total, lines: lines.length })
  void fiscalAfterCommit(sale)
  return sale
}

export function saleCompletedPayload(sale: Sale, lines: SaleLine[], payments: Payment[], cart: Pick<Cart, 'voided'>) {
  return {
    sale_id: sale.id,
    receipt_number: sale.receiptNumber,
    receipt_number_provisional: true,
    shift_id: sale.shiftId,
    cashier_id: sale.cashierId,
    currency: sale.currency,
    subtotal: sale.subtotal,
    discount_total: sale.discountTotal,
    total: sale.total,
    base_total_usd: sale.baseTotalUsd,
    receipt_currency: sale.receiptCurrency,
    rate_snapshot: sale.rateSnapshot,
    zig_total: sale.zigTotal,
    zig_rounding_step: sale.zigRoundingStep,
    tendered: sale.tendered,
    change_due: sale.changeDue,
    change_currency: sale.changeCurrency,
    exchange_rates: { ZWG: sale.exchangeRate },
    completed_at: sale.completedAt,
    fiscal: sale.fiscal,
    lines: lines.map((l) => ({
      line_id: l.id,
      line_no: l.lineNo,
      product_id: l.productId,
      sku: l.sku,
      qty: l.qty,
      unit_price: l.unitPrice,
      discount: l.discount,
      line_total: l.lineTotal,
      zig_unit_price: l.zigUnitPrice,
      zig_amount: l.zigAmount,
      zig_discount: l.zigDiscount,
      discount_approved_by: l.discountApprovedBy,
    })),
    payments: payments.map((p) => ({
      payment_id: p.id,
      method: p.method,
      currency: p.currency,
      amount: p.amount,
      rate: p.rate,
      base_amount: p.baseAmount,
      reference: p.reference,
    })),
    voided_lines: cart.voided.map((v) => ({
      product_id: v.productId,
      qty: v.qty,
      unit_price: v.unitPrice,
      voided_at: v.voidedAt,
      voided_by: v.voidedBy,
    })),
  }
}

/** Write-through persistence of the in-progress cart so a crash or power cut can recover it. */
export async function persistActiveCart(cart: Cart, shiftId: string | null): Promise<void> {
  if (cart.lines.length === 0 && cart.voided.length === 0) {
    await db.activeCart.delete('current')
    return
  }
  const row: ActiveCart = { id: 'current', ...cart, shiftId, updatedAt: new Date().toISOString() }
  await db.activeCart.put(row)
}

export async function loadActiveCart(): Promise<ActiveCart | undefined> {
  return db.activeCart.get('current')
}

export async function holdCart(cart: Cart, shiftId: string, cashier: Actor, label: string): Promise<HeldSale> {
  if (cart.lines.length === 0) throw new Error('Nothing to hold')
  const held: HeldSale = { id: createId(), ...cart, shiftId, cashierId: cashier.id, label: label.trim() || 'Held sale', heldAt: new Date().toISOString() }
  await db.transaction('rw', db.heldSales, db.activeCart, async () => {
    await db.heldSales.add(held)
    await db.activeCart.delete('current')
  })
  return held
}

export async function resumeHeld(heldId: string, shiftId: string): Promise<Cart> {
  return db.transaction('rw', db.heldSales, db.activeCart, async () => {
    const current = await db.activeCart.get('current')
    if (current && current.lines.length > 0) throw new Error('Finish or hold the current sale before resuming another')
    const held = await db.heldSales.get(heldId)
    if (!held) throw new Error('That held sale no longer exists')
    const cart: Cart = { lines: held.lines, voided: held.voided, startedAt: held.startedAt }
    await db.activeCart.put({ id: 'current', ...cart, shiftId, updatedAt: new Date().toISOString() })
    await db.heldSales.delete(heldId)
    return cart
  })
}

export async function logAudit(entry: Omit<AuditEntry, 'id' | 'at'>): Promise<void> {
  await db.auditLog.add({ id: createId(), at: new Date().toISOString(), ...entry })
}

/**
 * Abandoning a cart that had items is reported as `sale.voided` for loss-prevention review.
 * Clearing an empty cart is not an event.
 */
export async function voidCart(cart: Cart, shiftId: string, actor: Actor, reason: string): Promise<void> {
  if (cart.lines.length === 0 && cart.voided.length === 0) {
    await db.activeCart.delete('current')
    return
  }
  const auditId = createId()
  const at = new Date().toISOString()
  await db.transaction('rw', [db.auditLog, db.activeCart, ...outboxTables()], async () => {
    await db.auditLog.add({
      id: auditId,
      at,
      actorId: actor.id,
      actorName: actor.name,
      action: 'cart.cleared',
      detail: `${cart.lines.length} line(s) cleared: ${reason}`,
      shiftId,
    })
    await appendOutboxEvent({
      type: 'sale.voided',
      entityTable: 'auditLog',
      entityId: auditId,
      observedAt: at,
      payload: {
        shift_id: shiftId,
        voided_by: actor.id,
        reason,
        total: cartTotals(cart).total,
        lines: [...cart.lines, ...cart.voided].map((l: CartLine) => ({ product_id: l.productId, qty: l.qty, unit_price: l.unitPrice })),
      },
    })
    await db.activeCart.delete('current')
  })
}
