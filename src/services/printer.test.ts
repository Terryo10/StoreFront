import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { openTestShift, resetDb, sellCash } from '@/test/fixtures'
import { printReceipt, receiptBytes, loadReceiptData } from './printer'

describe('receipt printing', () => {
  beforeEach(resetDb)

  it('a printer failure neither loses nor duplicates the sale', async () => {
    const shift = await openTestShift()
    const sale = await sellCash(shift.id, [[1], [2]], '50')
    await db.settings.update('app', { printer: { ...(await db.settings.get('app'))!.printer, mockFailure: true } })

    const failed = await printReceipt(sale.id)
    expect(failed.ok).toBe(false)
    expect(await db.sales.count()).toBe(1)
    expect(await db.outbox.where('type').equals('sale.completed').count()).toBe(1)
    expect((await db.sales.get(sale.id))?.printStatus).toBe('failed')

    await db.settings.update('app', { printer: { ...(await db.settings.get('app'))!.printer, mockFailure: false } })
    const ok = await printReceipt(sale.id, { reprint: true })
    expect(ok.ok).toBe(true)
    const after = await db.sales.get(sale.id)
    expect(after?.printStatus).toBe('printed')
    expect(after?.printCount).toBe(1)
    expect(await db.sales.count()).toBe(1)
  })

  it('builds ESC/POS bytes with init, cut and optional drawer kick', async () => {
    const shift = await openTestShift()
    const sale = await sellCash(shift.id, [[1]], '10')
    const data = (await loadReceiptData(sale.id))!
    const bytes = receiptBytes(data, 42, true)
    expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40])
    expect(bytes.slice(-5)).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa])
    const text = String.fromCharCode(...bytes.filter((b) => b >= 0x20 && b < 0x7f))
    expect(text).toContain(sale.receiptNumber)
  })
})
