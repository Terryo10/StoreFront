import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '@/test/fixtures'
import { db } from '@/db/schema'
import { recordCount } from './count-service'
import { processOutbox } from './sync-engine'
import { resetMockPushCallCount, setMockFault, getMockPushCallCount } from '@/api/mock'

describe('sync engine', () => {
  beforeEach(async () => {
    await resetDb()
    setMockFault('none')
    resetMockPushCallCount()
  })

  it('acknowledges exact event ids and is idempotent-friendly', async () => {
    const stocktake = await db.stocktakes.filter((s) => s.status === 'counting').first()
    const line = await db.stocktakeLines.where('stocktakeId').equals(stocktake!.id).first()
    await recordCount({
      stocktakeId: stocktake!.id,
      productId: line!.productId,
      locationId: stocktake!.locationId,
      quantity: '1',
      mode: 'replace',
    })

    const first = await processOutbox({ force: true })
    expect(first.acknowledged).toBe(1)
    expect(getMockPushCallCount()).toBe(1)

    const second = await processOutbox({ force: true })
    expect(second.processed).toBe(0)

    const ev = await db.outbox.toCollection().first()
    expect(ev?.status).toBe('acknowledged')
  })

  it('keeps rejected and conflict events recoverable', async () => {
    const stocktake = await db.stocktakes.filter((s) => s.status === 'counting').first()
    const line = await db.stocktakeLines.where('stocktakeId').equals(stocktake!.id).first()
    await recordCount({
      stocktakeId: stocktake!.id,
      productId: line!.productId,
      locationId: stocktake!.locationId,
      quantity: '1',
      mode: 'replace',
    })

    setMockFault('conflict')
    const r = await processOutbox({ force: true })
    expect(r.conflicts).toBe(1)
    const ev = await db.outbox.toCollection().first()
    expect(ev?.status).toBe('conflict')
    expect(await db.conflicts.count()).toBe(1)

    setMockFault('reject')
    await recordCount({
      stocktakeId: stocktake!.id,
      productId: line!.productId,
      locationId: stocktake!.locationId,
      quantity: '2',
      mode: 'replace',
    })
    const r2 = await processOutbox({ force: true })
    expect(r2.rejected).toBeGreaterThanOrEqual(1)
    expect(await db.outbox.where('status').equals('rejected').count()).toBeGreaterThanOrEqual(1)
  })
})
