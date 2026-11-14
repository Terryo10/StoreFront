export const ROLES = ['owner', 'manager', 'supervisor', 'counter', 'auditor'] as const

export type Role = (typeof ROLES)[number]

export type StocktakeStatus = 'draft' | 'counting' | 'submitted' | 'approved' | 'posted'

export type CountMode = 'add' | 'replace'

export type SyncVisualStatus = 'pending' | 'synced' | 'conflict' | 'rejected'

export type ServerState = 'demo' | 'local-only' | 'mock-accepted' | 'server-accepted' | 'server-error'

export interface Product {
  id: string
  sku: string
  name: string
  unit: string
  category: string
  catalogueNumber: number | null
  active: boolean
  updatedAt: string
  source: 'demo-seed' | 'csv-local' | 'server'
}

export interface Barcode {
  id: string
  productId: string
  code: string
  isPrimary: boolean
}

export interface AuditEntry {
  id: string
  at: string
  actor: string
  action: string
  detail: string
  source: 'demo-seed' | 'mock-response' | 'server-response' | 'local'
}

export interface Stocktake {
  id: string
  branchId: string
  branchName: string
  name: string
  scope: 'full' | 'partial'
  blind: boolean
  status: StocktakeStatus
  locationId: string
  locationName: string
  createdAt: string
  startedAt: string | null
  submittedAt: string | null
  approvedAt: string | null
  postedAt: string | null
  version: number
  staleInventory: boolean
  serverState: ServerState
  lastError: string | null
  audit: AuditEntry[]
}

export interface StocktakeLine {
  id: string
  stocktakeId: string
  productId: string
  locationId: string
  expectedQty: string | null
  expectedSource: 'demo-seed' | 'server' | 'unknown'
  countedQty: string | null
  countEventCount: number
}

export interface CountEvent {
  id: string
  deviceId: string
  deviceSequence: number
  eventType: 'stocktake.count.recorded'
  stocktakeId: string
  productId: string
  locationId: string
  quantity: string
  mode: CountMode
  observedAt: string
  baseVersion: number | null
  syncStatus: SyncVisualStatus
  attemptCount: number
  lastError: string | null
  origin: 'device' | 'demo-seed'
}

export interface InventoryBalance {
  id: string
  productId: string
  locationId: string
  quantity: string
  asOf: string | null
  source: 'demo-seed' | 'server'
}

export interface SyncPushEvent {
  event_id: string
  device_id: string
  device_sequence: number
  event_type: 'stocktake.count.recorded'
  payload: {
    stocktake_id: string
    product_id: string
    quantity: string
    mode: CountMode
    observed_at: string
  }
}

export interface SyncEnvelope {
  events: SyncPushEvent[]
}

export interface SyncResult {
  event_id: string
  status: 'acknowledged' | 'rejected'
  error?: { code: string; message: string }
  result?: { duplicate?: boolean }
}

export interface SyncPushResponse {
  results: SyncResult[]
}

export interface SyncPullResponse {
  implemented: boolean
  checkpoint: string | null
  changes: unknown[]
  message: string
}

export interface SyncStatusSnapshot {
  deviceId: string | null
  deviceSequence: number
  lastSuccessfulPushAt: string | null
  lastAckDeviceSequence: number | null
  lastPullAttemptAt: string | null
  lastPullDetail: string | null
  pullAvailable: boolean
  pending: number
  rejected: number
  conflicts: number
  acknowledged: number
}

export interface Branch {
  id: string
  name: string
}

export interface Location {
  id: string
  name: string
}

export interface Session {
  userId: string
  name: string
  email: string
  role: Role
  token: string
  authMode: 'mock' | 'sanctum'
}
