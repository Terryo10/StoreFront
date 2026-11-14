import Decimal from 'decimal.js'

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP })

export type Qty = string

export function qty(value: string | number | Decimal | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0)
  return new Decimal(value)
}

export function qtyString(value: string | number | Decimal, scale = 6): Qty {
  return qty(value).toFixed(scale)
}

export function addQty(a: Qty | null | undefined, b: Qty | null | undefined): Qty {
  return qtyString(qty(a).plus(qty(b)))
}

export function applyCountMode(
  current: Qty | null | undefined,
  incoming: Qty,
  mode: 'add' | 'replace',
): Qty {
  if (mode === 'replace') return qtyString(incoming)
  return addQty(current, incoming)
}

export function variancePct(expected: Qty | null, counted: Qty | null): number | null {
  if (expected === null || counted === null) return null
  const e = qty(expected)
  if (e.isZero()) return counted === '0' || qty(counted).isZero() ? 0 : 100
  return qty(counted).minus(e).div(e).mul(100).toNumber()
}

export function isValidQuantityInput(raw: string): boolean {
  if (!raw.trim()) return false
  try {
    const d = new Decimal(raw)
    return d.isFinite() && !d.isNegative()
  } catch {
    return false
  }
}
