import { defaultTillCode, getOrCreateDeviceId } from '@/lib/ids'
import { money } from '@/lib/decimal'
import { db, DEFAULT_PRICE_LIST } from './schema'
import type { AppSettings, Barcode, PriceListEntry, Product, Stocktake, SyncMetadata } from './types'

export const SEED_VERSION = 1

const CATALOGUE: Array<{ category: string; items: Array<[string, string, number]> }> = [
  {
    category: 'Groceries',
    items: [
      ['Pearlenta Mealie Meal 10kg', 'bag', 7.5],
      ['Gold Leaf Rice 2kg', 'pack', 2.9],
      ['Natpak Sugar 2kg', 'pack', 2.4],
      ['Cascade Cooking Oil 2L', 'bottle', 4.8],
      ['Lobels Cream Crackers', 'pack', 1.2],
      ['Cerevita Original 500g', 'box', 3.1],
      ['Kapenta Dried 250g', 'pack', 2.75],
      ['Royco Soup Mix', 'sachet', 0.45],
    ],
  },
  {
    category: 'Beverages',
    items: [
      ['Mazoe Orange Crush 2L', 'bottle', 4.2],
      ['Coca-Cola 2L', 'bottle', 1.9],
      ['Tanganda Tea 100s', 'box', 2.6],
      ['Dairibord Milk 1L', 'carton', 1.35],
      ['Pfuko Maheu 500ml', 'bottle', 0.8],
      ['Schweppes Still Water 500ml', 'bottle', 0.5],
    ],
  },
  {
    category: 'Bakery',
    items: [
      ['Lobels Bread Loaf', 'loaf', 1.1],
      ['Bakers Inn Brown Loaf', 'loaf', 1.15],
      ['Proton Rolls 6s', 'pack', 1.0],
    ],
  },
  {
    category: 'Household',
    items: [
      ['Surf Washing Powder 2kg', 'pack', 4.4],
      ['Sunlight Bar Soap', 'bar', 0.9],
      ['Doom Insect Spray', 'can', 3.6],
      ['Matches 10 box pack', 'pack', 0.6],
      ['Candles 6 pack', 'pack', 1.25],
    ],
  },
  {
    category: 'Personal care',
    items: [
      ['Colgate Toothpaste 100ml', 'tube', 1.7],
      ['Vaseline Petroleum Jelly 250ml', 'jar', 2.3],
      ['Protex Soap 150g', 'bar', 1.05],
      ['Always Pads 8s', 'pack', 1.8],
    ],
  },
  {
    category: 'Snacks',
    items: [
      ['Willards Cheese Curls', 'pack', 0.5],
      ['Arenel Choice Assorted', 'pack', 1.6],
      ['Charhons Maputi', 'pack', 0.3],
      ['Lyons Maid Ice Pop', 'each', 0.25],
    ],
  },
  {
    category: 'Airtime & misc',
    items: [
      ['AA Batteries 4 pack', 'pack', 2.0],
      ['Exercise Book A4 96pg', 'each', 0.7],
      ['Plastic Carrier Bag', 'each', 0.05],
    ],
  },
]

export function generateCatalogue(count = 1000) {
  const now = new Date().toISOString()
  const flat = CATALOGUE.flatMap((c) => c.items.map((item) => ({ category: c.category, item })))
  const products: Product[] = []
  const barcodes: Barcode[] = []
  const prices: PriceListEntry[] = []

  for (let i = 1; i <= count; i++) {
    const base = flat[(i - 1) % flat.length]
    const [name, unit, price] = base.item
    const round = Math.floor((i - 1) / flat.length)
    const id = `prd-${String(i).padStart(5, '0')}`
    products.push({
      id,
      sku: `ZW${String(i).padStart(5, '0')}`,
      name: round === 0 ? name : `${name} (lot ${round + 1})`,
      category: base.category,
      unit,
      active: true,
      updatedAt: now,
      source: 'demo-seed',
    })
    barcodes.push({ code: `6009${String(i).padStart(9, '0')}`, productId: id, isPrimary: true })
    if (i % 25 === 0) barcodes.push({ code: `ALT${String(i).padStart(7, '0')}`, productId: id, isPrimary: false })
    prices.push({
      id: `${DEFAULT_PRICE_LIST}:${id}:USD`,
      priceListId: DEFAULT_PRICE_LIST,
      productId: id,
      currency: 'USD',
      price: money(price + round * 0.05),
      updatedAt: now,
      source: 'demo-seed',
    })
  }
  return { products, barcodes, prices }
}

export function defaultSettings(deviceId: string): AppSettings {
  return {
    id: 'app',
    apiMode: import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock',
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000',
    tillCode: defaultTillCode(deviceId),
    storeName: 'Demo store, Harare',
    currencies: ['USD', 'ZWG'],
    defaultExchangeRate: import.meta.env.VITE_DEFAULT_ZWG_RATE || '26.80',
    zigRoundingStep: '0.05',
    allowLineDiscounts: true,
    scannerSuffix: 'Enter',
    scannerMinLength: 4,
    scannerMaxInterKeyMs: 35,
    printer: { kind: 'mock', host: '192.168.1.50', port: 9100, devicePath: '', widthChars: 42, mockFailure: false },
    autoPrint: true,
    theme: 'light',
    seedVersion: 0,
  }
}

export async function ensureBaseline(): Promise<void> {
  const deviceId = getOrCreateDeviceId()

  await db.transaction('rw', db.settings, db.syncMetadata, async () => {
    if (!(await db.settings.get('app'))) await db.settings.put(defaultSettings(deviceId))
    const meta = await db.syncMetadata.get('device')
    if (!meta) {
      const fresh: SyncMetadata = {
        id: 'device',
        deviceId,
        deviceSequence: 0,
        shiftCounter: 0,
        lastPushAttemptAt: null,
        lastSuccessfulPushAt: null,
        lastPushError: null,
        authBlocked: false,
        lastPullAttemptAt: null,
        lastPullDetail: null,
        pullAvailable: false,
        catalogueUpdatedAt: null,
        catalogueSource: 'demo-seed',
      }
      await db.syncMetadata.put(fresh)
    } else if (meta.deviceId !== deviceId) {
      // IndexedDB is authoritative: restore the localStorage mirror instead of forking the device id.
      try {
        localStorage.setItem('pos.deviceId', meta.deviceId)
      } catch {
        /* storage blocked */
      }
    }
  })
}

/** Mock mode only: fills the local catalogue with 1,000 demo products and a few stocktakes. */
export async function seedDemoData(): Promise<void> {
  const settings = await db.settings.get('app')
  if (!settings || settings.seedVersion >= SEED_VERSION) return
  const { products, barcodes, prices } = generateCatalogue(1000)
  const now = new Date().toISOString()

  await db.transaction('rw', [db.products, db.barcodes, db.priceLists, db.stocktakes, db.settings, db.syncMetadata], async () => {
    await db.products.bulkPut(products)
    await db.barcodes.bulkPut(barcodes)
    await db.priceLists.bulkPut(prices)
    if ((await db.stocktakes.count()) === 0) await db.stocktakes.bulkPut(demoStocktakes(now))
    await db.syncMetadata.update('device', { catalogueUpdatedAt: now, catalogueSource: 'demo-seed' })
    await db.settings.update('app', { seedVersion: SEED_VERSION })
  })
}

function demoStocktakes(now: string): Stocktake[] {
  const base = {
    createdAt: now,
    submittedAt: null,
    submitEventId: null,
    serverState: 'demo' as const,
    source: 'demo-seed' as const,
  }
  return [
    {
      ...base,
      id: 'stk-blind-shelf',
      name: 'Aisle 3 groceries',
      locationName: 'Shop floor',
      blind: true,
      status: 'assigned',
      assignedTo: 'counter',
      expected: null,
    },
    {
      ...base,
      id: 'stk-blind-store',
      name: 'Back store full count',
      locationName: 'Storeroom',
      blind: true,
      status: 'open',
      assignedTo: null,
      expected: null,
    },
    {
      ...base,
      id: 'stk-open-bev',
      name: 'Beverages spot check (open count)',
      locationName: 'Fridge bay',
      blind: false,
      status: 'open',
      assignedTo: null,
      expected: { 'prd-00009': '24', 'prd-00010': '36', 'prd-00011': '12' },
    },
  ]
}
