import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { cartOf, cash, cashier, openTestShift, resetDb } from '@/test/fixtures'
import { completeSale } from '@/features/sale/sale-service'
import { closeShift, computeExpectedCash } from '@/features/shift/shift-service'
import { completeRefund, findSalesByReceipt, loadRefundable } from './refund-service'

const supervisor = { id: 'u-super', name: 'Rudo Chikore' }

describe('refunds', () => {
  beforeEach(resetDb)

  it('refunds selected lines proportionally and records sale.refunded', async () => {
    const shift = await openTestShift()
    const cart = await cartOf([1, '2'], [2])
    cart.lines[0].discount = '1.00'
    const sale = await completeSale({ cart, tenders: [cash('100')], shiftId: shift.id, cashier })

    const [found] = await findSalesByReceipt(sale.receiptNumber)
    const original = (await loadRefundable(found.id))!
    const line = original.lines.find((l) => l.productId === 'prd-00001')!
    expect(original.lines.map((l) => l.lineNo)).toEqual([1, 2])
    const refund = await completeRefund({ original, items: [{ lineId: line.id, qty: '1' }], reason: 'Damaged or faulty', approver: supervisor, method: 'cash', currency: 'USD', reference: null, shiftId: shift.id, cashier })

    // Line was 2 × 7.50 − 1.00 = 14.00, so one unit refunds 7.00.
    expect(refund.total).toBe('7.00')
    expect(refund.kind).toBe('refund')
    const ev = await db.outbox.get(refund.outboxEventId)
    expect(ev?.type).toBe('sale.refunded')
    expect(ev?.payload.approved_by).toBe('u-super')

    const again = (await loadRefundable(found.id))!
    expect(again.lines.find((l) => l.id === line.id)?.refundableQty).toBe('1')
    await expect(completeRefund({ original, items: [{ lineId: line.id, qty: '2' }], reason: 'Other', approver: supervisor, method: 'cash', currency: 'USD', reference: null, shiftId: shift.id, cashier })).rejects.toThrow()
  })

  it('computes expected cash per currency for the blind shift close', async () => {
    const shift = await openTestShift()
    const cart = await cartOf([1])
    // 7.50 sale, paid 10 USD cash: drawer gains 7.50.
    await completeSale({ cart, tenders: [cash('10')], shiftId: shift.id, cashier })
    // 2.90 sale, paid ZiG 100 at 26.80 (= 3.73 USD), change in ZiG.
    const s2 = await completeSale({ cart: await cartOf([2]), tenders: [cash('100', 'ZWG')], shiftId: shift.id, cashier })
    expect(s2.changeCurrency).toBe('ZWG')

    const expected = await computeExpectedCash((await db.shifts.get(shift.id))!)
    expect(expected.USD).toBe('57.50')
    expect(expected.ZWG).toBe(`${(100 - Number(s2.changeDue)).toFixed(2)}`)

    const closed = await closeShift({ shiftId: shift.id, counted: { USD: '57.00', ZWG: expected.ZWG! }, actor: cashier })
    expect(closed.status).toBe('closed')
    const ev = await db.outbox.get(closed.closeEventId!)
    expect(ev?.type).toBe('shift.closed')
    expect((ev?.payload.variance as Record<string, string>).USD).toBe('-0.50')
  })
})
