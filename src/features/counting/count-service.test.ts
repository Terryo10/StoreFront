import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { setMockFault } from '@/api/mock'
import { barcodeFor, resetDb } from '@/test/fixtures'
import { syncNow } from '@/services/sync-engine'
import { countSummary, recordCorrection, recordCount, submitStocktake } from './count-service'

const counter = { id: 'u-counter', name: 'Blessing Dube' }
const ST = 'stk-blind-shelf'

describe('counting', () => {
  beforeEach(resetDb)

  it('applies add and replace modes and queues one event per scan', async () => {
    await recordCount({ stocktakeId: ST, barcode: barcodeFor(5), quantity: '3', mode: 'add', counter })
    await recordCount({ stocktakeId: ST, barcode: barcodeFor(5), quantity: '2', mode: 'add', counter })
    const r = await recordCount({ stocktakeId: ST, barcode: barcodeFor(5), quantity: '4', mode: 'replace', counter })
    expect(r.kind === 'counted' && r.event.resultingQty).toBe('4')
    expect(await db.outbox.where('type').equals('stocktake.count.recorded').count()).toBe(3)
  })

  it('sends unknown barcodes to the exception list without inventing a product id', async () => {
    const r = await recordCount({ stocktakeId: ST, barcode: '9999999999999', quantity: '2', mode: 'add', counter })
    expect(r.kind).toBe('exception')
    const ev = await db.outbox.where('type').equals('stocktake.exception.recorded').first()
    expect(ev?.payload.product_id).toBeNull()
    expect(await db.products.count()).toBe(1000)
  })

  it('records corrections as new events and never edits history', async () => {
    const r = await recordCount({ stocktakeId: ST, barcode: barcodeFor(6), quantity: '10', mode: 'add', counter })
    if (r.kind !== 'counted') throw new Error('expected count')
    await recordCorrection({ eventId: r.event.id, quantity: '8', counter })
    const s = await countSummary(ST)
    expect(s.events).toHaveLength(2)
    expect((await db.countEvents.get(r.event.id))?.quantity).toBe('10')
    expect(s.latest.get('prd-00006')?.resultingQty).toBe('8')
    expect(s.latest.get('prd-00006')?.correctsEventId).toBe(r.event.id)
  })

  it('never claims a server-confirmed submission while offline', async () => {
    await recordCount({ stocktakeId: ST, barcode: barcodeFor(5), quantity: '1', mode: 'add', counter })
    setMockFault('offline')
    const st = await submitStocktake(ST, counter)
    expect(st.status).toBe('submitted_local')
    await syncNow({ manual: true })
    expect((await db.stocktakes.get(ST))?.status).toBe('submitted_local')
    expect((await db.stocktakes.get(ST))?.serverState).toBe('local-only')

    setMockFault('none')
    await syncNow({ manual: true })
    expect((await db.stocktakes.get(ST))?.status).toBe('submitted')
    expect((await db.stocktakes.get(ST))?.serverState).toBe('server-acknowledged')
  })
})
