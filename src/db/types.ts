import type { CurrencyCode } from '@/lib/currency'
import type { DecimalString } from '@/lib/decimal'
import type { Role } from '@/lib/permissions'

/**
 * local:     committed to IndexedDB, not yet sent.
 * pending:   sent at least once, no acknowledgement yet (or waiting to retry).
 * synced:    the server acknowledged this exact event id.
 * rejected:  the server refused the event (kept, never dropped).
 * conflict:  the server returned 409 for the event (kept, needs resolution).
 */
export type SyncState = 'local' | 'pending' | 'synced' | 'rejected' | 'conflict'

export type DataSource = 'demo-seed' | 'server'

export interface Product {
  id: string
  sku: string
  name: string
  category: string
  unit: string
  active: boolean
  updatedAt: string
  source: DataSource
}

export interface Barcode {
  /** The barcode value itself is the primary key, so lookup is a single index hit. */
  code: string
  productId: string
  isPrimary: boolean
}

export interface PriceListEntry {
  id: string
  priceListId: string
  productId: string
  currency: CurrencyCode
  price: DecimalString
  updatedAt: string
  source: DataSource
}

export interface CartLine {
  id: string
  productId: string
  sku: string
  name: string
  unit: string
  qty: DecimalString
  unitPrice: DecimalString
  discount: DecimalString
  discountApprovedBy: string | null
}

export interface VoidedLine extends CartLine {
  voidedAt: string
  voidedBy: string
}

export interface Cart {
  lines: CartLine[]
  voided: VoidedLine[]
  startedAt: string | null
}

export interface ActiveCart extends Cart {
  id: 'current'
  shiftId: string | null
  updatedAt: string
}

export interface HeldSale extends Cart {
  id: string
  shiftId: string
  cashierId: string
  label: string
  heldAt: string
}

export type PaymentMethod = 'cash' | 'card' | 'mobile_money'

export interface Payment {
  id: string
  saleId: string
  method: PaymentMethod
  currency: CurrencyCode
  /** Amount in `currency`. Negative for refunds paid out. */
  amount: DecimalString
  /** Foreign units per 1 base unit at the time of payment. "1" for base currency. */
  rate: DecimalString
  /** `amount` expressed in the base currency. */
  baseAmount: DecimalString
  reference: string | null
  createdAt: string
}

export type SaleKind = 'sale' | 'refund'
export type PrintStatus = 'not_printed' | 'printed' | 'failed'

/** What the customer receipt is denominated in. Stored even when a currency is hidden on the paper. */
export type ReceiptCurrency = 'USD' | 'ZiG' | 'SPLIT'

export interface Sale {
  id: string
  kind: SaleKind
  receiptNumber: string
  originalSaleId: string | null
  originalReceiptNumber: string | null
  shiftId: string
  deviceId: string
  cashierId: string
  cashierName: string
  currency: CurrencyCode
  subtotal: DecimalString
  discountTotal: DecimalString
  /** USD total. This stays the audit figure; the receipt may show ZiG instead. */
  total: DecimalString
  /** Same USD total, kept under its own name so a receipt change cannot drop it. */
  baseTotalUsd: DecimalString
  receiptCurrency: ReceiptCurrency
  /** ZiG per 1 USD used for this sale. Refunds copy the original sale's snapshot. */
  rateSnapshot: DecimalString
  /** USD total converted once at rateSnapshot and rounded to zigRoundingStep. */
  zigTotal: DecimalString
  zigRoundingStep: DecimalString
  /** Sum of tender amounts in each currency, including refunds (negative). */
  tendered: CurrencyAmounts
  paidBase: DecimalString
  changeDue: DecimalString
  changeCurrency: CurrencyCode
  exchangeRate: DecimalString
  refundReason: string | null
  approvedBy: string | null
  completedAt: string
  outboxEventId: string
  syncState: SyncState
  syncError: string | null
  printStatus: PrintStatus
  printCount: number
  lastPrintError: string | null
  /** Reserved for a future fiscal device integration. Always null until one is wired. */
  fiscal: Record<string, unknown> | null
}

export interface SaleLine {
  id: string
  saleId: string
  /** Position on the receipt, starting at 1. */
  lineNo: number
  productId: string
  sku: string
  name: string
  unit: string
  qty: DecimalString
  unitPrice: DecimalString
  discount: DecimalString
  lineTotal: DecimalString
  /** Unit price converted at the sale's rate and rounded per unit. Hidden on USD receipts. */
  zigUnitPrice: DecimalString
  /** This line's share of zigTotal. The last line absorbs the rounding difference. */
  zigAmount: DecimalString
  zigDiscount: DecimalString
  discountApprovedBy: string | null
  originalLineId: string | null
}

export type CurrencyAmounts = Partial<Record<CurrencyCode, DecimalString>>

export interface Shift {
  id: string
  number: number
  deviceId: string
  tillCode: string
  cashierId: string
  cashierName: string
  status: 'open' | 'closed'
  openedAt: string
  closedAt: string | null
  /** ZiG per 1 USD, set manually by the cashier or supervisor when the shift opens. */
  exchangeRate: DecimalString
  openingFloat: CurrencyAmounts
  countedCash: CurrencyAmounts | null
  expectedCash: CurrencyAmounts | null
  receiptSequence: number
  openEventId: string
  closeEventId: string | null
  syncState: SyncState
}

export type StocktakeStatus = 'assigned' | 'open' | 'counting' | 'submitted_local' | 'submitted'

export interface Stocktake {
  id: string
  name: string
  locationName: string
  blind: boolean
  status: StocktakeStatus
  assignedTo: string | null
  /** Only present for open (non-blind) stocktakes. Never populated for blind counts. */
  expected: Record<string, DecimalString> | null
  createdAt: string
  submittedAt: string | null
  submitEventId: string | null
  serverState: 'demo' | 'local-only' | 'server-acknowledged'
  source: DataSource
}

export interface CountEvent {
  id: string
  stocktakeId: string
  productId: string | null
  barcode: string
  quantity: DecimalString
  mode: 'add' | 'replace'
  /** Running local count after applying this event. Never an expected quantity. */
  resultingQty: DecimalString | null
  correctsEventId: string | null
  observedAt: string
  counterId: string
  syncState: SyncState
}

export interface CountException {
  id: string
  stocktakeId: string
  barcode: string
  quantity: DecimalString
  observedAt: string
  counterId: string
  outboxEventId: string
  syncState: SyncState
}

export type OutboxStatus = 'pending' | 'syncing' | 'acknowledged' | 'rejected' | 'conflict'

export type EventType =
  | 'sale.completed'
  | 'sale.voided'
  | 'sale.refunded'
  | 'shift.opened'
  | 'shift.closed'
  | 'stocktake.count.recorded'
  | 'stocktake.exception.recorded'
  | 'stocktake.submitted'

export type EntityTable = 'sales' | 'shifts' | 'countEvents' | 'countExceptions' | 'stocktakes' | 'auditLog'

export interface OutboxEvent {
  id: string
  deviceId: string
  deviceSequence: number
  type: EventType
  payload: Record<string, unknown>
  observedAt: string
  status: OutboxStatus
  attemptCount: number
  lastError: string | null
  lastErrorCode: string | null
  nextAttemptAt: string | null
  entityTable: EntityTable
  entityId: string
  createdAt: string
  updatedAt: string
  acknowledgedAt: string | null
}

export interface ConflictRecord {
  id: string
  outboxEventId: string
  eventType: EventType
  code: string
  message: string
  createdAt: string
  resolvedAt: string | null
  resolution: 'requeued' | 'kept_for_review' | null
}

export interface SyncMetadata {
  id: 'device'
  deviceId: string
  deviceSequence: number
  shiftCounter: number
  lastPushAttemptAt: string | null
  lastSuccessfulPushAt: string | null
  lastPushError: string | null
  authBlocked: boolean
  lastPullAttemptAt: string | null
  lastPullDetail: string | null
  pullAvailable: boolean
  catalogueUpdatedAt: string | null
  catalogueSource: DataSource
}

export type ApiMode = 'mock' | 'live'

export interface AppSettings {
  id: 'app'
  apiMode: ApiMode
  apiBaseUrl: string
  tillCode: string
  storeName: string
  currencies: CurrencyCode[]
  defaultExchangeRate: DecimalString
  /** ZiG receipt totals round to this step. 0.05 is the nearest 5 cents. */
  zigRoundingStep: DecimalString
  allowLineDiscounts: boolean
  scannerSuffix: 'Enter' | 'Tab'
  scannerMinLength: number
  scannerMaxInterKeyMs: number
  printer: PrinterSettings
  autoPrint: boolean
  theme: 'light' | 'dark'
  seedVersion: number
}

export interface PrinterSettings {
  kind: 'mock' | 'network' | 'device'
  host: string
  port: number
  devicePath: string
  widthChars: 32 | 42 | 48
  mockFailure: boolean
}

export interface LocalSession {
  id: 'session'
  userId: string
  name: string
  email: string
  role: Role
  authMode: 'mock' | 'sanctum'
  /** Mock tokens only. Real Sanctum tokens live in Electron safeStorage or in memory. */
  mockToken: string | null
  loggedInAt: string
}

export interface AuditEntry {
  id: string
  at: string
  actorId: string
  actorName: string
  action: 'line.voided' | 'cart.cleared' | 'discount.applied' | 'refund.approved' | 'receipt.reprinted' | 'drawer.opened' | 'conflict.resolved'
  detail: string
  shiftId: string | null
}
