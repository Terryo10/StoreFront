import { configureApi } from '@/api'
import { resetMockServer, setMockFault } from '@/api/mock'
import { db } from '@/db/schema'
import { ensureBaseline, seedDemoData } from '@/db/seed'
import type { Cart, CartLine } from '@/db/types'
import { toTenderLine, type Rates } from '@/features/payments/payment-math'
import { completeSale, type Actor } from '@/features/sale/sale-service'
import { openShift } from '@/features/shift/shift-service'
import { createId } from '@/lib/ids'
import { lookupBarcode } from '@/services/catalogue'

export const cashier: Actor = { id: 'u-cashier', name: 'Tendai Moyo' }

export async function resetDb() {
  db.close()
  await db.delete()
  await db.open()
  localStorage.clear()
  resetMockServer()
  setMockFault('none')
  configureApi({ mode: 'mock', baseUrl: 'http://127.0.0.1:8000' })
  await ensureBaseline()
  await seedDemoData()
}

export function barcodeFor(n: number) {
  return `6009${String(n).padStart(9, '0')}`
}

export async function cartLineFor(n: number, qty = '1'): Promise<CartLine> {
  const p = await lookupBarcode(barcodeFor(n))
  if (!p?.price) throw new Error(`No seeded product ${n}`)
  return { id: createId(), productId: p.id, sku: p.sku, name: p.name, unit: p.unit, qty, unitPrice: p.price, discount: '0.00', discountApprovedBy: null }
}

export async function cartOf(...items: Array<[number, string?]>): Promise<Cart> {
  const lines = await Promise.all(items.map(([n, q]) => cartLineFor(n, q ?? '1')))
  return { lines, voided: [], startedAt: new Date().toISOString() }
}

export async function openTestShift(rate = '26.80') {
  return openShift({ cashier, float: { USD: '50', ZWG: '0' }, exchangeRate: rate, tillCode: 'T01' })
}

export function rates(rate = '26.80'): Rates {
  return { USD: '1', ZWG: rate }
}

export function cash(amount: string, currency: 'USD' | 'ZWG' = 'USD', rate = '26.80') {
  return toTenderLine({ id: createId(), method: 'cash', currency, amount, reference: null }, rates(rate))
}

export async function sellCash(shiftId: string, items: Array<[number, string?]>, tendered: string) {
  const cart = await cartOf(...items)
  return completeSale({ cart, tenders: [cash(tendered)], shiftId, cashier })
}
