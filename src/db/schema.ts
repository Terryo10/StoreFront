import Dexie, { type EntityTable as DexieTable } from 'dexie'
import type {
  ActiveCart,
  AppSettings,
  AuditEntry,
  Barcode,
  ConflictRecord,
  CountEvent,
  CountException,
  HeldSale,
  LocalSession,
  OutboxEvent,
  Payment,
  PriceListEntry,
  Product,
  Sale,
  SaleLine,
  Shift,
  Stocktake,
  SyncMetadata,
} from './types'

export const DB_NAME = 'zw_pos'

export class PosDB extends Dexie {
  products!: DexieTable<Product, 'id'>
  barcodes!: DexieTable<Barcode, 'code'>
  priceLists!: DexieTable<PriceListEntry, 'id'>
  sales!: DexieTable<Sale, 'id'>
  saleLines!: DexieTable<SaleLine, 'id'>
  payments!: DexieTable<Payment, 'id'>
  shifts!: DexieTable<Shift, 'id'>
  heldSales!: DexieTable<HeldSale, 'id'>
  activeCart!: DexieTable<ActiveCart, 'id'>
  stocktakes!: DexieTable<Stocktake, 'id'>
  countEvents!: DexieTable<CountEvent, 'id'>
  countExceptions!: DexieTable<CountException, 'id'>
  outbox!: DexieTable<OutboxEvent, 'id'>
  syncMetadata!: DexieTable<SyncMetadata, 'id'>
  conflicts!: DexieTable<ConflictRecord, 'id'>
  settings!: DexieTable<AppSettings, 'id'>
  session!: DexieTable<LocalSession, 'id'>
  auditLog!: DexieTable<AuditEntry, 'id'>

  constructor(name = DB_NAME) {
    super(name)

    // Migrations: never edit a shipped version. Add `this.version(n + 1)` with an upgrade function.
    this.version(1).stores({
      products: 'id, sku, name, category, active',
      barcodes: 'code, productId',
      priceLists: 'id, [priceListId+productId], productId',
      sales: 'id, receiptNumber, shiftId, kind, originalSaleId, completedAt, syncState, outboxEventId',
      saleLines: 'id, saleId, productId',
      payments: 'id, saleId, method',
      shifts: 'id, status, cashierId, openedAt',
      heldSales: 'id, shiftId, heldAt',
      activeCart: 'id',
      stocktakes: 'id, status, assignedTo',
      countEvents: 'id, stocktakeId, [stocktakeId+productId], observedAt',
      countExceptions: 'id, stocktakeId, barcode',
      outbox: 'id, status, deviceSequence, type, entityId, [status+deviceSequence]',
      syncMetadata: 'id',
      conflicts: 'id, outboxEventId, resolvedAt',
      settings: 'id',
      session: 'id',
      auditLog: 'id, at, action, shiftId',
    })
  }
}

export const db = new PosDB()

export const DEFAULT_PRICE_LIST = 'retail'
