import type { Barcode, Product, Stocktake, StocktakeLine } from '@/domain/types'
import { createId, getOrCreateDeviceId } from '@/lib/ids'
import { qtyString } from '@/lib/decimal'
import { db, type AppSettings, type SyncMetadata } from './schema'

const CATEGORIES = [
  'Groceries',
  'Beverages',
  'Household',
  'Personal Care',
  'Hardware',
  'Stationery',
  'Frozen',
  'Bakery',
]

const UNITS = ['ea', 'kg', 'l', 'pack', 'box']

const PRODUCT_NAMES = [
  'Mazoe Orange Crush',
  'Lobels Cream Crackers',
  'Cerevita Original',
  'Tanganda Tea',
  'Cascade Cooking Oil',
  'Surf Washing Powder',
  'Colgate Toothpaste',
  'Coca-Cola 2L',
  'Empire Biscuits',
  'Willards Cheese Curls',
  'Dairibord Milk 1L',
  'Pearlenta Mealie Meal',
  'Blue Ribbon Bread',
  'Natpak Sugar 2kg',
  'Kapenta Dried',
  'Rice Long Grain',
  'Sunlight Soap',
  'Vaseline Petroleum Jelly',
  'Batteries AA Pack',
  'Exercise Book A4',
]

function pad(n: number, width: number) {
  return String(n).padStart(width, '0')
}

export function generateMockCatalogue(count = 1000): {
  products: Product[]
  barcodes: Barcode[]
} {
  const products: Product[] = []
  const barcodes: Barcode[] = []
  const now = new Date().toISOString()

  for (let i = 1; i <= count; i++) {
    const id = createId()
    const nameBase = PRODUCT_NAMES[(i - 1) % PRODUCT_NAMES.length]
    const product: Product = {
      id,
      sku: `ZW-${pad(i, 5)}`,
      name: `${nameBase} #${i}`,
      unit: UNITS[(i - 1) % UNITS.length],
      category: CATEGORIES[(i - 1) % CATEGORIES.length],
      catalogueNumber: i,
      active: i % 47 !== 0,
      updatedAt: now,
      source: 'demo-seed',
    }
    products.push(product)
    barcodes.push({
      id: createId(),
      productId: id,
      code: `6039${pad(i, 9)}`,
      isPrimary: true,
    })
    if (i % 11 === 0) {
      barcodes.push({
        id: createId(),
        productId: id,
        code: `ALT${pad(i, 8)}`,
        isPrimary: false,
      })
    }
  }

  return { products, barcodes }
}

const DEMO_SEED_VERSION = 1

export async function ensureSeeded(): Promise<void> {
  const deviceId = getOrCreateDeviceId()
  const settings = await db.settings.get('app')
  const meta = await db.syncMetadata.get('device')

  if (!settings) {
    const defaultSettings: AppSettings = {
      id: 'app',
      apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000',
      apiMode: (import.meta.env.VITE_API_MODE as 'mock' | 'live') || 'mock',
      scannerMode: 'hid',
      replaceDefault: true,
      theme: 'light',
      offlinePolicyNote:
        'Counts are saved locally first. Sync is manual/foreground until Background Sync is reliable on this device.',
      demoSeedVersion: 0,
    }
    await db.settings.put(defaultSettings)
  } else if (settings.demoSeedVersion == null) {
    await db.settings.update('app', { demoSeedVersion: 0 })
  }

  if (!meta) {
    const syncMeta: SyncMetadata = {
      id: 'device',
      deviceId,
      deviceSequence: 0,
      lastSuccessfulPushAt: null,
      lastAckDeviceSequence: null,
      lastPullAttemptAt: null,
      lastPullDetail: 'Server pull not available — catalogue may be stale.',
      pullAvailable: false,
    }
    await db.syncMetadata.put(syncMeta)
  } else if (meta.deviceId !== deviceId) {
    await db.syncMetadata.update('device', { deviceId })
  }

  const current = (await db.settings.get('app'))!
  if ((current.demoSeedVersion ?? 0) >= DEMO_SEED_VERSION && (await db.products.count()) > 0) {
    return
  }

  if ((await db.products.count()) === 0) {
    const { products, barcodes } = generateMockCatalogue(1000)
    await db.transaction('rw', db.products, db.barcodes, db.inventoryBalances, async () => {
      await db.products.bulkPut(products)
      await db.barcodes.bulkPut(barcodes)
      await db.inventoryBalances.bulkPut(
        products.slice(0, 200).map((p, idx) => ({
          id: `${p.id}:loc-shopfloor`,
          productId: p.id,
          locationId: 'loc-shopfloor',
          quantity: qtyString((idx % 40) + 1),
          asOf: new Date().toISOString(),
          source: 'demo-seed' as const,
        })),
      )
    })
  }

  if ((await db.stocktakes.count()) === 0) {
    await seedDemoStocktakes()
  }

  await db.settings.update('app', { demoSeedVersion: DEMO_SEED_VERSION })
}

async function seedDemoStocktakes() {
  const products = await db.products.orderBy('catalogueNumber').limit(80).toArray()
  const now = new Date()
  const draftId = createId()
  const countingId = createId()
  const submittedId = createId()

  const mk = (
    id: string,
    name: string,
    status: Stocktake['status'],
    extras: Partial<Stocktake> = {},
  ): Stocktake => ({
    id,
    branchId: 'branch-harare-cbd',
    branchName: 'Harare CBD',
    name,
    scope: 'partial',
    blind: true,
    status,
    locationId: 'loc-shopfloor',
    locationName: 'Shop floor',
    createdAt: now.toISOString(),
    startedAt: status === 'draft' ? null : now.toISOString(),
    submittedAt: status === 'submitted' || status === 'approved' || status === 'posted' ? now.toISOString() : null,
    approvedAt: null,
    postedAt: null,
    version: 1,
    staleInventory: false,
    serverState: 'demo',
    lastError: null,
    audit: [
      {
        id: createId(),
        at: now.toISOString(),
        actor: 'Demo seed',
        action: 'created',
        detail: 'Seeded for offline demo',
        source: 'demo-seed',
      },
    ],
    ...extras,
  })

  const stocktakes = [
    mk(draftId, 'March dry goods check', 'draft'),
    mk(countingId, 'Weekend full count — in progress', 'counting', {
      scope: 'full',
      name: 'Weekend full count — in progress',
    }),
    mk(submittedId, 'Beverages aisle (submitted)', 'submitted', {
      blind: true,
      scope: 'partial',
    }),
  ]

  const lines: StocktakeLine[] = []
  for (const st of stocktakes) {
    const slice = products.slice(0, st.scope === 'full' ? 60 : 30)
    for (const p of slice) {
      const balance = await db.inventoryBalances.get(`${p.id}:loc-shopfloor`)
      lines.push({
        id: createId(),
        stocktakeId: st.id,
        productId: p.id,
        locationId: st.locationId,
        expectedQty: balance?.quantity ?? qtyString((p.catalogueNumber ?? 1) % 25),
        expectedSource: 'demo-seed',
        countedQty: null,
        countEventCount: 0,
      })
    }
  }

  await db.transaction('rw', db.stocktakes, db.stocktakeLines, async () => {
    await db.stocktakes.bulkPut(stocktakes)
    await db.stocktakeLines.bulkPut(lines)
  })
}

export const BRANCHES = [
  { id: 'branch-harare-cbd', name: 'Harare CBD' },
  { id: 'branch-bulawayo', name: 'Bulawayo Main' },
  { id: 'branch-mutare', name: 'Mutare' },
]

export const LOCATIONS = [
  { id: 'loc-shopfloor', name: 'Shop floor' },
  { id: 'loc-backstore', name: 'Back store' },
  { id: 'loc-coldroom', name: 'Cold room' },
]
