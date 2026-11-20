import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { barcodeFor, resetDb } from '@/test/fixtures'
import { lookupBarcode, searchProducts } from './catalogue'
import { parseScanInput } from './scanner'

describe('local catalogue', () => {
  beforeEach(resetDb)

  it('seeds 1,000 priced products', async () => {
    expect(await db.products.count()).toBe(1000)
    expect(await db.priceLists.count()).toBe(1000)
  })

  it('looks up barcodes from IndexedDB fast enough to feel instant', async () => {
    const started = performance.now()
    for (let i = 1; i <= 200; i++) {
      const p = await lookupBarcode(barcodeFor(((i * 37) % 1000) + 1))
      expect(p?.price).toBeTruthy()
    }
    const perLookup = (performance.now() - started) / 200
    expect(perLookup).toBeLessThan(15)
  })

  it('returns null for unknown barcodes instead of inventing a product', async () => {
    expect(await lookupBarcode('0000000000000')).toBeNull()
  })

  it('searches by name and SKU', async () => {
    expect((await searchProducts('mazoe')).length).toBeGreaterThan(0)
    expect((await searchProducts('ZW00001'))[0]?.sku).toBe('ZW00001')
  })

  it('parses quantity-prefixed scans', () => {
    expect(parseScanInput('3*6009000000001')).toEqual({ quantity: '3', code: '6009000000001' })
    expect(parseScanInput('6009000000001')).toEqual({ quantity: '1', code: '6009000000001' })
  })
})
