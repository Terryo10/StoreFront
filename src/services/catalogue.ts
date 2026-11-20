import { ApiError, fetchAllProducts, getApiConfig, lookupBarcodeRemote, pullChanges } from '@/api'
import type { ApiProduct } from '@/api/types'
import { db, DEFAULT_PRICE_LIST } from '@/db/schema'
import type { Barcode, PriceListEntry, Product } from '@/db/types'
import { money } from '@/lib/decimal'
import { track } from '@/lib/telemetry'

export interface PricedProduct extends Product {
  price: string | null
}

async function withPrice(product: Product | undefined): Promise<PricedProduct | null> {
  if (!product) return null
  const entry = await db.priceLists.get(`${DEFAULT_PRICE_LIST}:${product.id}:USD`)
  return { ...product, price: entry?.price ?? null }
}

/** Local IndexedDB lookup first. Falls back to the server only in live mode, and caches the answer. */
export async function lookupBarcode(code: string, { allowRemote = true } = {}): Promise<PricedProduct | null> {
  const value = code.trim()
  if (!value) return null
  const hit = await db.barcodes.get(value)
  if (hit) return withPrice(await db.products.get(hit.productId))

  if (!allowRemote || getApiConfig().mode !== 'live') return null
  try {
    const remote = await lookupBarcodeRemote(value)
    if (!remote) return null
    await upsertProducts([remote])
    const cached = await db.barcodes.get(value)
    return cached ? withPrice(await db.products.get(cached.productId)) : null
  } catch (err) {
    track('catalogue.remote_lookup_failed', { code: value, error: err instanceof Error ? err.message : String(err) }, 'warn')
    return null
  }
}

export async function searchProducts(term: string, limit = 12): Promise<PricedProduct[]> {
  const q = term.trim().toLowerCase()
  if (q.length < 2) return []
  const bySku = await db.products.where('sku').equalsIgnoreCase(q).toArray()
  const byName = await db.products
    .filter((p) => p.active && (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().startsWith(q)))
    .limit(limit)
    .toArray()
  const seen = new Set<string>()
  const merged = [...bySku, ...byName].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true))).slice(0, limit)
  return Promise.all(merged.map((p) => withPrice(p))) as Promise<PricedProduct[]>
}

export async function listCategories(): Promise<string[]> {
  const keys = await db.products.orderBy('category').uniqueKeys()
  return keys.map(String)
}

export async function quickItems(category: string | null, limit = 30): Promise<PricedProduct[]> {
  const coll = category ? db.products.where('category').equals(category) : db.products.orderBy('sku')
  const items = await coll.filter((p) => p.active).limit(limit).toArray()
  return Promise.all(items.map((p) => withPrice(p))) as Promise<PricedProduct[]>
}

function mapApiProduct(p: ApiProduct, now: string) {
  const product: Product = {
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    unit: p.unit,
    active: p.active,
    updatedAt: p.updated_at ?? now,
    source: 'server',
  }
  const barcodes: Barcode[] = p.barcodes.map((b) => ({ code: b.code, productId: p.id, isPrimary: b.is_primary }))
  const prices: PriceListEntry[] = p.prices.map((pr) => ({
    id: `${pr.price_list_id}:${p.id}:${pr.currency}`,
    priceListId: pr.price_list_id,
    productId: p.id,
    currency: pr.currency,
    price: money(pr.price),
    updatedAt: p.updated_at ?? now,
    source: 'server',
  }))
  return { product, barcodes, prices }
}

async function upsertProducts(items: ApiProduct[]) {
  const now = new Date().toISOString()
  const mapped = items.map((p) => mapApiProduct(p, now))
  await db.transaction('rw', db.products, db.barcodes, db.priceLists, async () => {
    await db.products.bulkPut(mapped.map((m) => m.product))
    await db.barcodes.bulkPut(mapped.flatMap((m) => m.barcodes))
    await db.priceLists.bulkPut(mapped.flatMap((m) => m.prices))
  })
}

export interface CatalogueRefreshResult {
  ok: boolean
  message: string
  count?: number
}

/**
 * Live mode: tries GET /sync/pull first; when the server does not implement it, falls back to a
 * full GET /products download. Either way the "last updated" time only moves on real server data.
 */
export async function refreshCatalogue(onProgress?: (msg: string) => void): Promise<CatalogueRefreshResult> {
  const now = new Date().toISOString()
  if (getApiConfig().mode === 'mock') {
    await db.syncMetadata.update('device', { lastPullAttemptAt: now, pullAvailable: false, lastPullDetail: 'Mock mode: catalogue is the local demo seed.' })
    return { ok: false, message: 'Mock mode uses the local demo catalogue. Nothing was downloaded.' }
  }

  try {
    const pull = await pullChanges(null)
    if (pull.available) {
      await upsertProducts(pull.products)
      await db.syncMetadata.update('device', { lastPullAttemptAt: now, pullAvailable: true, lastPullDetail: `Pulled ${pull.products.length} changes`, catalogueUpdatedAt: now, catalogueSource: 'server' })
      return { ok: true, message: `Pulled ${pull.products.length} product changes`, count: pull.products.length }
    }
    await db.syncMetadata.update('device', { lastPullAttemptAt: now, pullAvailable: false, lastPullDetail: pull.reason })

    onProgress?.('Sync pull unavailable; downloading full product list…')
    const all = await fetchAllProducts((page, last) => onProgress?.(`Downloading products, page ${page} of ${last}`))
    const mapped = all.map((p) => mapApiProduct(p, now))
    await db.transaction('rw', [db.products, db.barcodes, db.priceLists, db.syncMetadata], async () => {
      await db.products.clear()
      await db.barcodes.clear()
      await db.priceLists.clear()
      await db.products.bulkPut(mapped.map((m) => m.product))
      await db.barcodes.bulkPut(mapped.flatMap((m) => m.barcodes))
      await db.priceLists.bulkPut(mapped.flatMap((m) => m.prices))
      await db.syncMetadata.update('device', { catalogueUpdatedAt: now, catalogueSource: 'server' })
    })
    return { ok: true, message: `Downloaded ${all.length} products`, count: all.length }
  } catch (err) {
    const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Catalogue refresh failed'
    await db.syncMetadata.update('device', { lastPullAttemptAt: now, lastPullDetail: message })
    return { ok: false, message }
  }
}
