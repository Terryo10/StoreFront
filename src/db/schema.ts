import Dexie, { type EntityTable, type Table } from 'dexie'
import type {
  AuditEntry,
  Barcode,
  CountEvent,
  InventoryBalance,
  Product,
  Role,
  Stocktake,
  StocktakeLine,
  SyncVisualStatus,
} from '@/domain/types'

export type OutboxStatus = 'pending' | 'syncing' | 'acknowledged' | 'rejected' | 'conflict'

export interface OutboxEvent {
  id: string
  deviceId: string
  deviceSequence: number
  eventType: 'stocktake.count.recorded'
  stocktakeId: string
  productId: string
  locationId: string
  quantity: string
  mode: 'add' | 'replace'
  observedAt: string
  baseVersion: number | null
  status: OutboxStatus
  attemptCount: number
  lastError: string | null
  nextAttemptAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ConflictRecord {
  id: string
  outboxEventId: string
  stocktakeId: string
  productId: string
  code: string
  message: string
  createdAt: string
  resolvedAt: string | null
  resolution: string | null
}

export interface SyncMetadata {
  id: 'device'
  deviceId: string
  deviceSequence: number
  lastSuccessfulPushAt: string | null
  lastAckDeviceSequence: number | null
  lastPullAttemptAt: string | null
  lastPullDetail: string | null
  pullAvailable: boolean
}

export interface AppSettings {
  id: 'app'
  apiBaseUrl: string
  apiMode: 'mock' | 'live'
  scannerMode: 'hid' | 'camera' | 'manual'
  replaceDefault: boolean
  theme: 'light' | 'dark' | 'system'
  offlinePolicyNote: string
  demoSeedVersion: number
}

export interface UnknownBarcodeHold {
  id: string
  code: string
  stocktakeId: string
  observedAt: string
  note: string | null
  status: 'held' | 'resolved'
}

export interface LocalSession {
  id: 'session'
  userId: string
  name: string
  email: string
  role: Role
  token: string
  authMode: 'mock' | 'sanctum'
  loggedInAt: string
}

export interface CountView {
  id: string
  stocktakeId: string
  productId: string
  locationId: string
  quantity: string
  lastEventId: string
  updatedAt: string
  syncStatus: SyncVisualStatus
}

export class StocktakeDB extends Dexie {
  products!: EntityTable<Product, 'id'>
  barcodes!: EntityTable<Barcode, 'id'>
  stocktakes!: EntityTable<Stocktake, 'id'>
  stocktakeLines!: EntityTable<StocktakeLine, 'id'>
  countEvents!: EntityTable<CountEvent, 'id'>
  countViews!: EntityTable<CountView, 'id'>
  outbox!: EntityTable<OutboxEvent, 'id'>
  syncMetadata!: EntityTable<SyncMetadata, 'id'>
  conflicts!: EntityTable<ConflictRecord, 'id'>
  settings!: EntityTable<AppSettings, 'id'>
  inventoryBalances!: EntityTable<InventoryBalance, 'id'>
  unknownBarcodes!: EntityTable<UnknownBarcodeHold, 'id'>
  session!: EntityTable<LocalSession, 'id'>
  auditLog!: Table<AuditEntry, string>

  constructor() {
    super('stocktake_v1')

    this.version(1).stores({
      products: 'id, sku, name, category, active, updatedAt',
      barcodes: 'id, productId, code, isPrimary',
      stocktakes: 'id, status, branchId, createdAt, name',
      stocktakeLines: 'id, stocktakeId, productId, locationId',
      countEvents: 'id, stocktakeId, productId, deviceSequence, observedAt, syncStatus',
      countViews: 'id, stocktakeId, productId, locationId, updatedAt, syncStatus',
      outbox: 'id, status, deviceSequence, stocktakeId, nextAttemptAt, createdAt',
      syncMetadata: 'id, deviceId',
      conflicts: 'id, outboxEventId, stocktakeId, createdAt, resolvedAt',
      settings: 'id',
      inventoryBalances: 'id, productId, locationId',
      unknownBarcodes: 'id, code, stocktakeId, status, observedAt',
      session: 'id',
      auditLog: 'id, at, action',
    })

    this.version(2).stores({
      products: 'id, sku, name, category, catalogueNumber, active, updatedAt',
      barcodes: 'id, productId, code, isPrimary',
      stocktakes: 'id, status, branchId, createdAt, name',
      stocktakeLines: 'id, stocktakeId, productId, locationId, [stocktakeId+productId]',
      countEvents: 'id, stocktakeId, productId, deviceSequence, observedAt, syncStatus',
      countViews: 'id, stocktakeId, productId, locationId, lastEventId, updatedAt, syncStatus',
      outbox: 'id, status, deviceSequence, stocktakeId, nextAttemptAt, createdAt',
      syncMetadata: 'id, deviceId',
      conflicts: 'id, outboxEventId, stocktakeId, createdAt, resolvedAt',
      settings: 'id',
      inventoryBalances: 'id, productId, locationId',
      unknownBarcodes: 'id, code, stocktakeId, status, observedAt',
      session: 'id',
      auditLog: 'id, at, action',
    })
  }
}

export const db = new StocktakeDB()
