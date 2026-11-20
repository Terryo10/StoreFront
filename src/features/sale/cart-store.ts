import { create } from 'zustand'
import type { Cart, CartLine } from '@/db/types'
import { add, dec, money, qty as qtyStr, type DecimalString } from '@/lib/decimal'
import { createId } from '@/lib/ids'
import type { PricedProduct } from '@/services/catalogue'
import { EMPTY_CART, persistActiveCart } from './sale-service'

interface CartState {
  cart: Cart
  shiftId: string | null
  selectedId: string | null
  /** Resolves once the most recent cart change is durable in IndexedDB. */
  flushed: Promise<void>
  load: (cart: Cart, shiftId: string | null) => void
  addProduct: (product: PricedProduct, quantity?: DecimalString) => CartLine
  setQty: (lineId: string, quantity: DecimalString) => void
  step: (lineId: string, delta: 1 | -1) => void
  setDiscount: (lineId: string, discount: DecimalString, approvedBy: string | null) => void
  voidLine: (lineId: string, actorName: string) => CartLine | null
  select: (lineId: string | null) => void
  moveSelection: (delta: 1 | -1) => void
  reset: () => void
}

let writeChain: Promise<void> = Promise.resolve()

/** Serialises writes so the stored cart always matches the latest in-memory state. */
function persist(cart: Cart, shiftId: string | null): Promise<void> {
  writeChain = writeChain
    .catch(() => undefined)
    .then(() => persistActiveCart(cart, shiftId))
    .catch((err) => {
      console.error('[pos] could not persist cart', err)
      throw err
    })
  return writeChain
}

export const useCart = create<CartState>((set, get) => {
  function commit(cart: Cart, selectedId: string | null = get().selectedId) {
    const flushed = persist(cart, get().shiftId)
    set({ cart, selectedId, flushed })
  }

  return {
    cart: EMPTY_CART,
    shiftId: null,
    selectedId: null,
    flushed: Promise.resolve(),

    load: (cart, shiftId) => set({ cart, shiftId, selectedId: cart.lines.at(-1)?.id ?? null }),

    addProduct: (product, quantity = '1') => {
      if (!product.price) throw new Error(`${product.name} has no price on this till`)
      const { cart } = get()
      const existing = cart.lines.find((l) => l.productId === product.id && dec(l.discount).isZero())
      if (existing) {
        const updated = { ...existing, qty: qtyStr(add(existing.qty, quantity)) }
        const lines = cart.lines.filter((l) => l.id !== existing.id).concat(updated)
        commit({ ...cart, lines }, updated.id)
        return updated
      }
      const line: CartLine = {
        id: createId(),
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        qty: qtyStr(quantity),
        unitPrice: money(product.price),
        discount: '0.00',
        discountApprovedBy: null,
      }
      commit({ ...cart, startedAt: cart.startedAt ?? new Date().toISOString(), lines: [...cart.lines, line] }, line.id)
      return line
    },

    setQty: (lineId, quantity) => {
      const { cart } = get()
      if (dec(quantity).lessThanOrEqualTo(0)) return
      commit({ ...cart, lines: cart.lines.map((l) => (l.id === lineId ? { ...l, qty: qtyStr(quantity) } : l)) })
    },

    step: (lineId, delta) => {
      const line = get().cart.lines.find((l) => l.id === lineId)
      if (!line) return
      const next = dec(line.qty).plus(delta)
      if (next.lessThanOrEqualTo(0)) return
      get().setQty(lineId, next.toFixed())
    },

    setDiscount: (lineId, discount, approvedBy) => {
      const { cart } = get()
      commit({ ...cart, lines: cart.lines.map((l) => (l.id === lineId ? { ...l, discount: money(discount), discountApprovedBy: approvedBy } : l)) })
    },

    voidLine: (lineId, actorName) => {
      const { cart } = get()
      const idx = cart.lines.findIndex((l) => l.id === lineId)
      if (idx < 0) return null
      const line = cart.lines[idx]
      const lines = cart.lines.filter((l) => l.id !== lineId)
      const nextSel = lines[Math.min(idx, lines.length - 1)]?.id ?? null
      commit({ ...cart, lines, voided: [...cart.voided, { ...line, voidedAt: new Date().toISOString(), voidedBy: actorName }] }, nextSel)
      return line
    },

    select: (lineId) => set({ selectedId: lineId }),

    moveSelection: (delta) => {
      const { cart, selectedId } = get()
      if (cart.lines.length === 0) return
      const idx = cart.lines.findIndex((l) => l.id === selectedId)
      const next = idx < 0 ? cart.lines.length - 1 : Math.max(0, Math.min(cart.lines.length - 1, idx + delta))
      set({ selectedId: cart.lines[next].id })
    },

    reset: () => set({ cart: EMPTY_CART, selectedId: null, flushed: Promise.resolve() }),
  }
})
