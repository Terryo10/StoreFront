import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { cash, cashier, cartOf, openTestShift, resetDb } from '@/test/fixtures'
import { completeSale } from '@/features/sale/sale-service'
import { toTenderLine } from '@/features/payments/payment-math'
import { closeShift, computeExpectedCash } from '@/features/shift/shift-service'
import { completeRefund, loadRefundable } from '@/features/returns/refund-service'
import { createId } from '@/lib/ids'
import { dec } from '@/lib/decimal'
import { loadReceiptData, receiptRows, rowsToText } from './printer'
import { allocateZigAmounts, buildReceiptModel, RECEIPT_NOTICE } from './receipt-model'

const supervisor = { id: 'u-super', name: 'Rudo Chikore' }

function paper(data: NonNullable<Awaited<ReturnType<typeof loadReceiptData>>>, width = 42) {
  return rowsToText(receiptRows(data), width).join('\n')
}

describe('receipt model', () => {
  beforeEach(resetDb)

  it('prints a USD cash sale without a ZiG equivalent or the rate', async () => {
    const shift = await openTestShift()
    const sale = await completeSale({ cart: await cartOf([1]), tenders: [cash('10')], shiftId: shift.id, cashier })
    expect(sale.total).toBe('7.50')
    expect(sale.baseTotalUsd).toBe('7.50')
    expect(sale.receiptCurrency).toBe('USD')
    expect(sale.zigTotal).toBe('201.00')
    expect(sale.tendered.USD).toBe('10.00')

    const text = paper((await loadReceiptData(sale.id))!)
    expect(text).toContain('TOTAL USD')
    expect(text).toContain('7.50')
    expect(text).toContain('Cash USD')
    expect(text).not.toMatch(/ZiG|ZWG|Equivalent|Rate/)
  })

  it('prints a ZiG-only sale entirely in ZiG', async () => {
    const shift = await openTestShift()
    const sale = await completeSale({ cart: await cartOf([1]), tenders: [cash('250', 'ZWG')], shiftId: shift.id, cashier })
    expect(sale.receiptCurrency).toBe('ZiG')
    expect(sale.baseTotalUsd).toBe('7.50')

    const text = paper((await loadReceiptData(sale.id))!)
    expect(text).toContain('TOTAL ZiG')
    expect(text).toContain('201.00')
    expect(text).toContain('Cash ZiG')
    expect(text).toContain('Change ZiG')
    expect(text).not.toMatch(/USD|Rate/)
  })

  it('shows the rate once on a split tender and the change in the currency given', async () => {
    const shift = await openTestShift()
    const card = toTenderLine({ id: createId(), method: 'card', currency: 'USD', amount: '5.00', reference: 'TML123' }, { USD: '1', ZWG: '26.80' })
    const sale = await completeSale({ cart: await cartOf([1]), tenders: [card, cash('100', 'ZWG')], shiftId: shift.id, cashier })
    const data = (await loadReceiptData(sale.id))!
    const model = buildReceiptModel(data)
    const text = paper(data)

    expect(model.receiptCurrency).toBe('SPLIT')
    expect(model.total).toMatchObject({ value: '7.50', currency: 'USD' })
    expect(model.rateNote).toBe('Rate 1 USD = 26.8000 ZiG')
    expect(text.match(/Rate 1 USD/g)).toHaveLength(1)
    expect(model.change?.label).toBe('Change ZiG')
    expect(model.change?.value).toBe(sale.changeDue)
    expect(text).toContain(`Change ZiG`)
    expect(text).toContain('Card USD')
    expect(text).toContain('Cash ZiG')
    expect(text).not.toContain('Equivalent')
  })

  it('makes the last ZiG line absorb a rounding difference', () => {
    const { zigTotal, amounts } = allocateZigAmounts(['0.01', '0.01', '0.01'], '0.03', '26.80', '0.05')
    expect(amounts.slice(0, 2)).toEqual(['0.25', '0.25'])
    expect(amounts[2]).not.toBe('0.25')
    expect(amounts.reduce((acc, v) => acc.plus(dec(v)), dec(0)).toFixed(2)).toBe(zigTotal)
    expect(zigTotal).toBe('0.80')
  })

  it('reprints the original receipt from stored figures after the rounding step changes', async () => {
    const shift = await openTestShift()
    const sale = await completeSale({ cart: await cartOf([1], [2]), tenders: [cash('20')], shiftId: shift.id, cashier })
    const first = receiptRows((await loadReceiptData(sale.id))!)

    await db.settings.update('app', { zigRoundingStep: '1' })
    const stored = await db.sales.get(sale.id)
    expect(stored?.zigRoundingStep).toBe('0.05')
    const again = receiptRows((await loadReceiptData(sale.id))!)
    expect(again).toEqual(first)

    const reprint = receiptRows((await loadReceiptData(sale.id, true))!)
    expect(reprint.filter((r) => !(r.kind === 'center' && r.text.includes('REPRINT')))).toEqual(first)
  })

  it('refunds a ZiG sale at the original rate, not the rate of the new shift', async () => {
    const first = await openTestShift('26.80')
    const sale = await completeSale({ cart: await cartOf([1]), tenders: [cash('201', 'ZWG')], shiftId: first.id, cashier })
    const expected = await computeExpectedCash((await db.shifts.get(first.id))!)
    await closeShift({ shiftId: first.id, counted: { USD: expected.USD!, ZWG: expected.ZWG! }, actor: cashier })

    const next = await openTestShift('30.00')
    const original = (await loadRefundable(sale.id))!
    const refund = await completeRefund({
      original,
      items: original.lines.map((l) => ({ lineId: l.id, qty: l.refundableQty })),
      reason: 'Damaged or faulty',
      approver: supervisor,
      method: 'cash',
      currency: 'ZWG',
      reference: null,
      shiftId: next.id,
      cashier,
    })

    expect(refund.rateSnapshot).toBe('26.8000')
    expect(refund.baseTotalUsd).toBe('7.50')
    expect(refund.zigTotal).toBe('201.00')
    expect(refund.zigTotal).not.toBe('225.00')
    const text = paper((await loadReceiptData(refund.id))!)
    expect(text).toContain('REFUND TOTAL ZiG')
    expect(text).toContain('201.00')
    expect(text).not.toMatch(/225\.00|USD|Rate/)
  })

  it('keeps every line within 58mm and 80mm paper, including the notice', async () => {
    const shift = await openTestShift()
    const card = toTenderLine({ id: createId(), method: 'card', currency: 'USD', amount: '5.00', reference: 'TML123' }, { USD: '1', ZWG: '26.80' })
    const sale = await completeSale({ cart: await cartOf([1]), tenders: [card, cash('100', 'ZWG')], shiftId: shift.id, cashier })
    const data = (await loadReceiptData(sale.id))!
    data.lines[0].name = 'Very long product name that cannot fit on a narrow roll'

    for (const width of [32, 42]) {
      const lines = rowsToText(receiptRows(data), width)
      expect(lines.every((line) => line.length <= width)).toBe(true)
      expect(lines.some((line) => line.includes(RECEIPT_NOTICE))).toBe(true)
      expect(lines.some((line) => line.includes('Rate 1 USD = 26.8000 ZiG'))).toBe(true)
    }
    expect(RECEIPT_NOTICE.length).toBeLessThanOrEqual(32)
  })
})
