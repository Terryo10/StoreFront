import { db } from '@/db/schema'
import type { Payment, PaymentMethod, Sale, SaleLine } from '@/db/types'
import { BASE_CURRENCY, type CurrencyCode } from '@/lib/currency'
import { dec, money, qty as qtyStr, roundToStep, sum, type DecimalString } from '@/lib/decimal'
import { createId, formatReceiptNumber } from '@/lib/ids'
import { track } from '@/lib/telemetry'
import { appendOutboxEvent, outboxTables } from '@/services/outbox'
import { fiscalPrepare } from '@/services/fiscal'
import { allocateZigAmounts, receiptCurrencyOf } from '@/services/receipt-model'
import { sumByCurrency, type Actor } from '@/features/sale/sale-service'

export interface RefundableLine extends SaleLine {
  refundedQty: DecimalString
  refundableQty: DecimalString
}

export interface RefundableSale {
  sale: Sale
  lines: RefundableLine[]
  payments: Payment[]
}

export async function loadRefundable(saleId: string): Promise<RefundableSale | null> {
  const sale = await db.sales.get(saleId)
  if (!sale || sale.kind !== 'sale') return null
  const [lines, payments, refunds] = await Promise.all([
    db.saleLines.where('saleId').equals(saleId).sortBy('lineNo'),
    db.payments.where('saleId').equals(saleId).toArray(),
    db.sales.where('originalSaleId').equals(saleId).toArray(),
  ])
  const refundLines = (await Promise.all(refunds.map((r) => db.saleLines.where('saleId').equals(r.id).toArray()))).flat()
  return {
    sale,
    payments,
    lines: lines.map((l) => {
      const refunded = refundLines.filter((r) => r.originalLineId === l.id).reduce((acc, r) => acc.plus(dec(r.qty)), dec(0))
      return { ...l, refundedQty: qtyStr(refunded), refundableQty: qtyStr(dec(l.qty).minus(refunded)) }
    }),
  }
}

/** Only sales made on this till are searchable offline. Cross-till lookup needs the server. */
export async function findSalesByReceipt(receipt: string): Promise<Sale[]> {
  const term = receipt.trim().toUpperCase()
  if (!term) return []
  const exact = await db.sales.where('receiptNumber').equals(term).filter((s) => s.kind === 'sale').toArray()
  if (exact.length) return exact
  return db.sales.filter((s) => s.kind === 'sale' && s.receiptNumber.endsWith(term)).limit(10).toArray()
}

export async function findSalesByBarcode(barcode: string): Promise<Sale[]> {
  const bc = await db.barcodes.get(barcode.trim())
  if (!bc) return []
  const lines = await db.saleLines.where('productId').equals(bc.productId).toArray()
  const ids = [...new Set(lines.map((l) => l.saleId))]
  const sales = (await db.sales.bulkGet(ids)).filter((s): s is Sale => !!s && s.kind === 'sale')
  return sales.sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 20)
}

export function refundLineAmount(line: SaleLine, refundQty: DecimalString): DecimalString {
  // Proportional to the amount actually paid for the line, so discounts are respected.
  return money(dec(line.lineTotal).mul(dec(refundQty)).div(dec(line.qty)))
}

export const REFUND_REASONS = ['Damaged or faulty', 'Expired', 'Wrong item sold', 'Customer changed mind', 'Price dispute', 'Other'] as const

export async function completeRefund(input: {
  original: RefundableSale
  items: Array<{ lineId: string; qty: DecimalString }>
  reason: string
  approver: Actor
  method: PaymentMethod
  currency: CurrencyCode
  reference: string | null
  shiftId: string
  cashier: Actor
}): Promise<Sale> {
  const items = input.items.filter((i) => dec(i.qty).greaterThan(0))
  if (items.length === 0) throw new Error('Select at least one item to refund')
  if (!input.reason.trim()) throw new Error('Choose a refund reason')

  const refundId = createId()
  const eventId = createId()
  const at = new Date().toISOString()

  const lines: SaleLine[] = items.map((item, i) => {
    const orig = input.original.lines.find((l) => l.id === item.lineId)
    if (!orig) throw new Error('Refund line does not belong to the original sale')
    if (dec(item.qty).greaterThan(dec(orig.refundableQty))) throw new Error(`Only ${orig.refundableQty} of ${orig.name} can still be refunded`)
    return {
      id: createId(),
      saleId: refundId,
      lineNo: i + 1,
      productId: orig.productId,
      sku: orig.sku,
      name: orig.name,
      unit: orig.unit,
      qty: qtyStr(item.qty),
      unitPrice: orig.unitPrice,
      discount: '0.00',
      lineTotal: refundLineAmount(orig, item.qty),
      zigUnitPrice: '0.00',
      zigAmount: '0.00',
      zigDiscount: '0.00',
      discountApprovedBy: null,
      originalLineId: orig.id,
    }
  })
  const total = sum(lines.map((l) => l.lineTotal))
  const rateSnapshot = input.original.sale.rateSnapshot || input.original.sale.exchangeRate
  const step = input.original.sale.zigRoundingStep || '0.05'
  const allocated = allocateZigAmounts(lines.map((l) => l.lineTotal), total, rateSnapshot, step)
  const pricedLines: SaleLine[] = lines.map((l, i) => ({
    ...l,
    zigUnitPrice: roundToStep(dec(l.unitPrice).mul(dec(rateSnapshot)), step),
    zigAmount: allocated.amounts[i] ?? '0.00',
    zigDiscount: '0.00',
  }))

  const shiftPeek = await db.shifts.get(input.shiftId)
  if (!shiftPeek || shiftPeek.status !== 'open') throw new Error('No open shift on this till')
  const fiscal = await fiscalPrepare({
    kind: 'refund',
    receiptNumber: formatReceiptNumber(shiftPeek.tillCode, shiftPeek.number, shiftPeek.receiptSequence + 1),
    total,
    currency: BASE_CURRENCY,
    lines: pricedLines,
  })

  const sale = await db.transaction('rw', [db.sales, db.saleLines, db.payments, db.shifts, ...outboxTables()], async () => {
    const shift = await db.shifts.get(input.shiftId)
    if (!shift || shift.status !== 'open') throw new Error('No open shift on this till')

    // Re-check against refunds committed since the screen loaded.
    const priorRefunds = await db.sales.where('originalSaleId').equals(input.original.sale.id).toArray()
    for (const r of priorRefunds) {
      const rl = await db.saleLines.where('saleId').equals(r.id).toArray()
      for (const item of lines) {
        const orig = input.original.lines.find((l) => l.id === item.originalLineId)!
        const already = rl.filter((x) => x.originalLineId === orig.id).reduce((acc, x) => acc.plus(dec(x.qty)), dec(0))
        if (already.plus(dec(item.qty)).greaterThan(dec(orig.qty))) throw new Error(`${orig.name} was already refunded`)
      }
    }

    const rate = input.currency === BASE_CURRENCY ? '1' : rateSnapshot
    const amount = input.currency === BASE_CURRENCY ? total : allocated.zigTotal
    const payment: Payment = {
      id: createId(),
      saleId: refundId,
      method: input.method,
      currency: input.currency,
      amount: money(dec(amount).negated()),
      rate,
      baseAmount: money(dec(total).negated()),
      reference: input.reference,
      createdAt: at,
    }
    const sequence = shift.receiptSequence + 1
    const record: Sale = {
      id: refundId,
      kind: 'refund',
      receiptNumber: formatReceiptNumber(shift.tillCode, shift.number, sequence),
      originalSaleId: input.original.sale.id,
      originalReceiptNumber: input.original.sale.receiptNumber,
      shiftId: shift.id,
      deviceId: shift.deviceId,
      cashierId: input.cashier.id,
      cashierName: input.cashier.name,
      currency: BASE_CURRENCY,
      subtotal: total,
      discountTotal: '0.00',
      total,
      baseTotalUsd: total,
      receiptCurrency: receiptCurrencyOf([payment.currency]),
      rateSnapshot,
      zigTotal: allocated.zigTotal,
      zigRoundingStep: step,
      tendered: sumByCurrency([payment]),
      paidBase: payment.baseAmount,
      changeDue: '0.00',
      changeCurrency: input.currency,
      exchangeRate: rateSnapshot,
      refundReason: input.reason,
      approvedBy: input.approver.name,
      completedAt: at,
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
    await db.saleLines.bulkAdd(pricedLines)
    await db.payments.add(payment)
    await appendOutboxEvent({
      id: eventId,
      type: 'sale.refunded',
      entityTable: 'sales',
      entityId: refundId,
      observedAt: at,
      payload: {
        refund_id: refundId,
        receipt_number: record.receiptNumber,
        receipt_number_provisional: true,
        original_sale_id: input.original.sale.id,
        original_receipt_number: input.original.sale.receiptNumber,
        shift_id: shift.id,
        cashier_id: input.cashier.id,
        approved_by: input.approver.id,
        reason: input.reason,
        total,
        base_total_usd: total,
        currency: BASE_CURRENCY,
        receipt_currency: record.receiptCurrency,
        rate_snapshot: rateSnapshot,
        zig_total: allocated.zigTotal,
        lines: pricedLines.map((l) => ({ line_id: l.id, original_line_id: l.originalLineId, product_id: l.productId, qty: l.qty, amount: l.lineTotal, zig_amount: l.zigAmount })),
        payment: { method: payment.method, currency: payment.currency, amount: payment.amount, rate: payment.rate, base_amount: payment.baseAmount, reference: payment.reference },
        fiscal,
      },
    })
    return record
  })
  track('sale.refunded', { receipt: sale.receiptNumber, total })
  return sale
}
