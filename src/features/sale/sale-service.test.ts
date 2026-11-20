import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/schema'
import { cartOf, cash, cashier, openTestShift, resetDb, sellCash } from '@/test/fixtures'
import { completeSale, holdCart, persistActiveCart, resumeHeld, SaleCommitError, voidCart } from './sale-service'
import { useCart } from './cart-store'
import { lookupBarcode } from '@/services/catalogue'
import { barcodeFor } from '@/test/fixtures'

describe('sale commit', () => {
  beforeEach(resetDb)

  it('writes sale, lines, payments and one outbox event together, then clears the active cart', async () => {
    const shift = await openTestShift()
    const cart = await cartOf([1, '2'], [2])
    await persistActiveCart(cart, shift.id)

    const sale = await completeSale({ cart, tenders: [cash('50')], shiftId: shift.id, cashier })

    expect(await db.sales.count()).toBe(1)
    expect(await db.saleLines.where('saleId').equals(sale.id).count()).toBe(2)
    expect(await db.payments.where('saleId').equals(sale.id).count()).toBe(1)
    const ev = await db.outbox.get(sale.outboxEventId)
    expect(ev?.type).toBe('sale.completed')
    expect(ev?.status).toBe('pending')
    expect(ev?.payload.total).toBe(sale.total)
    expect(sale.syncState).toBe('local')
    expect(await db.activeCart.get('current')).toBeUndefined()
    expect(sale.receiptNumber).toBe('T01-0001-0001')
  })

  it('rolls everything back when any part of the transaction fails', async () => {
    const shift = await openTestShift()
    const cart = await cartOf([3])
    await persistActiveCart(cart, shift.id)
    const before = await db.outbox.count()
    const spy = vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('disk full'))

    await expect(completeSale({ cart, tenders: [cash('20')], shiftId: shift.id, cashier })).rejects.toThrow('disk full')
    spy.mockRestore()

    expect(await db.sales.count()).toBe(0)
    expect(await db.saleLines.count()).toBe(0)
    expect(await db.payments.count()).toBe(0)
    expect(await db.outbox.count()).toBe(before)
    expect((await db.shifts.get(shift.id))?.receiptSequence).toBe(0)
    expect((await db.activeCart.get('current'))?.lines).toHaveLength(1)
  })

  it('refuses unpaid sales and sales without an open shift', async () => {
    const shift = await openTestShift()
    const cart = await cartOf([1])
    await expect(completeSale({ cart, tenders: [cash('0.01')], shiftId: shift.id, cashier })).rejects.toBeInstanceOf(SaleCommitError)
    await expect(completeSale({ cart, tenders: [cash('100')], shiftId: 'nope', cashier })).rejects.toThrow(/No open shift/)
  })

  it('numbers receipts per till and shift with a monotonic sequence', async () => {
    const shift = await openTestShift()
    const numbers = []
    for (let i = 0; i < 5; i++) numbers.push((await sellCash(shift.id, [[i + 1]], '100')).receiptNumber)
    expect(numbers).toEqual(['T01-0001-0001', 'T01-0001-0002', 'T01-0001-0003', 'T01-0001-0004', 'T01-0001-0005'])
    const seqs = (await db.outbox.orderBy('deviceSequence').toArray()).map((e) => e.deviceSequence)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  it('logs a cleared cart as sale.voided', async () => {
    const shift = await openTestShift()
    const cart = await cartOf([1], [2])
    await voidCart(cart, shift.id, cashier, 'test')
    const ev = await db.outbox.where('type').equals('sale.voided').first()
    expect(ev?.payload.lines).toHaveLength(2)
    expect(await db.auditLog.where('action').equals('cart.cleared').count()).toBe(1)
  })
})

describe('cart recovery', () => {
  beforeEach(async () => {
    await resetDb()
    useCart.getState().reset()
  })

  it('persists every cart change so a crash can recover the sale in progress', async () => {
    const shift = await openTestShift()
    useCart.setState({ shiftId: shift.id })
    const p = await lookupBarcode(barcodeFor(7))
    useCart.getState().addProduct(p!, '2')
    useCart.getState().addProduct(p!, '1')
    await useCart.getState().flushed

    const stored = await db.activeCart.get('current')
    expect(stored?.lines).toHaveLength(1)
    expect(stored?.lines[0].qty).toBe('3')

    // Simulate an app restart: in-memory state is gone, IndexedDB is not.
    useCart.getState().reset()
    const recovered = await db.activeCart.get('current')
    useCart.getState().load(recovered!, shift.id)
    expect(useCart.getState().cart.lines[0].qty).toBe('3')
  })

  it('holds and resumes a sale', async () => {
    const shift = await openTestShift()
    const cart = await cartOf([1], [2, '3'])
    await persistActiveCart(cart, shift.id)
    const held = await holdCart(cart, shift.id, cashier, 'Mrs Banda')
    expect(await db.activeCart.get('current')).toBeUndefined()
    expect(await db.heldSales.count()).toBe(1)

    const resumed = await resumeHeld(held.id, shift.id)
    expect(resumed.lines).toHaveLength(2)
    expect(await db.heldSales.count()).toBe(0)
    expect((await db.activeCart.get('current'))?.lines).toHaveLength(2)
  })

  it('will not resume over a cart that still has items', async () => {
    const shift = await openTestShift()
    const held = await holdCart(await cartOf([1]), shift.id, cashier, '')
    await persistActiveCart(await cartOf([2]), shift.id)
    await expect(resumeHeld(held.id, shift.id)).rejects.toThrow(/Finish or hold/)
  })
})
