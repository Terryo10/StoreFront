import type { Cart, CartLine } from '@/db/types'
import { add, dec, money, mul, sum, type DecimalString } from '@/lib/decimal'

export function lineGross(line: Pick<CartLine, 'qty' | 'unitPrice'>): DecimalString {
  return money(mul(line.qty, line.unitPrice))
}

export function lineTotal(line: Pick<CartLine, 'qty' | 'unitPrice' | 'discount'>): DecimalString {
  return money(dec(lineGross(line)).minus(dec(line.discount)))
}

export interface CartTotals {
  itemCount: DecimalString
  subtotal: DecimalString
  discountTotal: DecimalString
  total: DecimalString
}

export function cartTotals(cart: Pick<Cart, 'lines'>): CartTotals {
  const subtotal = sum(cart.lines.map(lineGross))
  const discountTotal = sum(cart.lines.map((l) => l.discount))
  return {
    itemCount: add(...cart.lines.map((l) => l.qty)).toFixed(),
    subtotal,
    discountTotal,
    total: money(dec(subtotal).minus(dec(discountTotal))),
  }
}

/** A discount must be non-negative and cannot exceed the line's gross value. */
export function validateDiscount(line: Pick<CartLine, 'qty' | 'unitPrice'>, discount: DecimalString): string | null {
  const d = dec(discount)
  if (d.isNegative()) return 'Discount cannot be negative'
  if (d.greaterThan(dec(lineGross(line)))) return 'Discount cannot be more than the line value'
  return null
}
