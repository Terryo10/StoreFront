import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { mockDeliveredCount, mockPushCallCount, setMockFault } from '@/api/mock'
import { openTestShift, resetDb, sellCash } from '@/test/fixtures'
import { MAX_BATCH, recoverInterruptedSync, requeueEvent, syncNow } from './sync-engine'

async function salesOffline(count: number, shiftId: string) {
  for (let i = 0; i < count; i++) await sellCash(shiftId, [[(i % 900) + 1]], '100')
}

describe('sync engine', () => {
  beforeEach(resetDb)

  it('marks only acknowledged event ids as synced', async () => {
    const shift = await openTestShift()
    const sale = await sellCash(shift.id, [[1]], '20')
    const r = await syncNow({ manual: true })
    expect(r.acknowledged).toBe(2)
    expect((await db.sales.get(sale.id))?.syncState).toBe('synced')
    expect((await db.outbox.get(sale.outboxEventId))?.status).toBe('acknowledged')
    expect((await db.syncMetadata.get('device'))?.lastSuccessfulPushAt).not.toBeNull()
  })

  it('delivers 100 offline sales exactly once logically, in batches of at most 100', async () => {
    const shift = await openTestShift()
    await salesOffline(50, shift.id)
    setMockFault('offline')
    await salesOffline(50, shift.id)
    const offlineRun = await syncNow({ manual: true })
    expect(offlineRun.stoppedReason).toBe('network')
    expect(await db.outbox.where('status').equals('acknowledged').count()).toBe(0)

    setMockFault('none')
    const r = await syncNow({ manual: true })
    expect(r.acknowledged).toBe(101) // shift.opened + 100 sales
    expect(mockDeliveredCount()).toBe(101)
    expect(await db.sales.where('syncState').equals('synced').count()).toBe(100)
    expect(MAX_BATCH).toBe(100)
  })

  it('stays idempotent when the server stores events but the response is lost', async () => {
    const shift = await openTestShift()
    await sellCash(shift.id, [[1]], '20')
    setMockFault('drop_response')
    const lost = await syncNow({ manual: true })
    expect(lost.acknowledged).toBe(0)
    expect(await db.outbox.where('status').equals('pending').count()).toBe(2)
    expect(mockDeliveredCount()).toBe(2)

    setMockFault('none')
    const retry = await syncNow({ manual: true })
    expect(retry.acknowledged).toBe(2)
    expect(mockDeliveredCount()).toBe(2)
  })

  it('collapses duplicate results in a single response', async () => {
    const shift = await openTestShift()
    await sellCash(shift.id, [[1]], '20')
    setMockFault('duplicate_results')
    const r = await syncNow({ manual: true })
    expect(r.acknowledged).toBe(2)
    expect(await db.outbox.where('status').equals('acknowledged').count()).toBe(2)
  })

  it('stops on 401 without retrying in a loop and keeps events pending', async () => {
    const shift = await openTestShift()
    await sellCash(shift.id, [[1]], '20')
    setMockFault('http401')
    const before = mockPushCallCount()
    const r = await syncNow({ manual: true })
    expect(r.stoppedReason).toBe('auth')
    expect(mockPushCallCount() - before).toBe(1)
    expect(await db.outbox.where('status').equals('pending').count()).toBe(2)
    expect((await db.syncMetadata.get('device'))?.authBlocked).toBe(true)

    const auto = await syncNow()
    expect(auto.stoppedReason).toBe('blocked')
    expect(mockPushCallCount() - before).toBe(1)
  })

  it('treats 403 like 401: paused, nothing dropped', async () => {
    const shift = await openTestShift()
    await sellCash(shift.id, [[1]], '20')
    setMockFault('http403')
    await syncNow({ manual: true })
    expect(await db.outbox.count()).toBe(2)
    expect(await db.outbox.where('status').equals('pending').count()).toBe(2)
  })

  it('preserves events on 409 with a conflict record and allows re-queueing', async () => {
    const shift = await openTestShift()
    const sale = await sellCash(shift.id, [[1]], '20')
    setMockFault('http409')
    const r = await syncNow({ manual: true })
    expect(r.conflicts).toBe(2)
    expect((await db.sales.get(sale.id))?.syncState).toBe('conflict')
    expect(await db.conflicts.filter((c) => c.resolvedAt === null).count()).toBe(2)

    setMockFault('none')
    expect((await syncNow({ manual: true })).stoppedReason).toBe('nothing_due')
    await requeueEvent(sale.outboxEventId)
    await syncNow({ manual: true })
    expect((await db.sales.get(sale.id))?.syncState).toBe('synced')
  })

  it('keeps 422-rejected events visible and never drops them', async () => {
    const shift = await openTestShift()
    const sale = await sellCash(shift.id, [[1]], '20')
    setMockFault('reject422')
    const r = await syncNow({ manual: true })
    expect(r.rejected).toBe(2)
    const ev = await db.outbox.get(sale.outboxEventId)
    expect(ev?.status).toBe('rejected')
    expect(ev?.lastError).toMatch(/422/)
    expect((await db.sales.get(sale.id))?.syncState).toBe('rejected')
    expect(await db.outbox.count()).toBe(2)
  })

  it('backs off after network failures instead of hammering the server', async () => {
    const shift = await openTestShift()
    await sellCash(shift.id, [[1]], '20')
    setMockFault('offline')
    await syncNow({ manual: true })
    const ev = await db.outbox.where('type').equals('sale.completed').first()
    expect(ev?.attemptCount).toBe(1)
    expect(ev?.nextAttemptAt && ev.nextAttemptAt > new Date().toISOString()).toBe(true)
    setMockFault('none')
    const auto = await syncNow()
    expect(auto.stoppedReason).toBe('nothing_due')
  })

  it('recovers events left mid-send by a crash', async () => {
    const shift = await openTestShift()
    const sale = await sellCash(shift.id, [[1]], '20')
    await db.outbox.update(sale.outboxEventId, { status: 'syncing' })
    expect(await recoverInterruptedSync()).toBe(1)
    expect((await db.outbox.get(sale.outboxEventId))?.status).toBe('pending')
  })
})
