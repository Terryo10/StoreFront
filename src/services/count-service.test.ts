import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '@/test/fixtures'
import { db } from '@/db/schema'
import { recordCount, lookupLocalProductByBarcode } from './count-service'

describe('recordCount', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('persists count event and outbox atomically with monotonic sequence', async () => {
    const stocktake = await db.stocktakes.filter((s) => s.status === 'counting').first()
    const line = await db.stocktakeLines.where('stocktakeId').equals(stocktake!.id).first()
    expect(stocktake && line).toBeTruthy()

    const first = await recordCount({
      stocktakeId: stocktake!.id,
      productId: line!.productId,
      locationId: stocktake!.locationId,
      quantity: '2',
      mode: 'add',
    })
    const second = await recordCount({
      stocktakeId: stocktake!.id,
      productId: line!.productId,
      locationId: stocktake!.locationId,
      quantity: '3',
      mode: 'add',
    })

    expect(second.event.deviceSequence).toBe(first.event.deviceSequence + 1)
    expect(second.displayQty).toBe('5.000000')

    const outbox = await db.outbox.orderBy('deviceSequence').toArray()
    expect(outbox).toHaveLength(2)
    expect(outbox.every((e) => e.status === 'pending')).toBe(true)

    const replace = await recordCount({
      stocktakeId: stocktake!.id,
      productId: line!.productId,
      locationId: stocktake!.locationId,
      quantity: '9',
      mode: 'replace',
    })
    expect(replace.displayQty).toBe('9.000000')
    const events = await db.countEvents.where('productId').equals(line!.productId).count()
    expect(events).toBe(3)
  })

  it('looks up seeded barcodes quickly', async () => {
    const barcode = await db.barcodes.toCollection().first()
    const product = await lookupLocalProductByBarcode(barcode!.code)
    expect(product?.id).toBe(barcode!.productId)
  })
})
