import Decimal from 'decimal.js'

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP })

/** Monetary and quantity values are always decimal strings at rest and on the wire. */
export type DecimalString = string

export function dec(value: DecimalString | number | Decimal | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0)
  return new Decimal(value)
}

export function money(value: DecimalString | number | Decimal | null | undefined, scale = 2): DecimalString {
  return dec(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale)
}

export function qty(value: DecimalString | number | Decimal | null | undefined, scale = 3): DecimalString {
  const d = dec(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP)
  return d.isInteger() ? d.toFixed(0) : d.toFixed()
}

export function add(...values: Array<DecimalString | Decimal | null | undefined>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0))
}

export function sum(values: Array<DecimalString | Decimal | null | undefined>, scale = 2): DecimalString {
  return money(add(...values), scale)
}

export function mul(a: DecimalString | Decimal, b: DecimalString | Decimal): Decimal {
  return dec(a).mul(dec(b))
}

export function isZero(value: DecimalString | null | undefined): boolean {
  return dec(value).isZero()
}

export function isPositive(value: DecimalString | null | undefined): boolean {
  return dec(value).greaterThan(0)
}

export function compare(a: DecimalString, b: DecimalString): number {
  return dec(a).comparedTo(dec(b))
}

/**
 * Rounds to the nearest multiple of `step` (half away from zero).
 * 0.05 rounds cash to the nearest 5 cents. The result keeps at least 2 decimal places.
 */
export function roundToStep(value: DecimalString | Decimal, step: DecimalString): DecimalString {
  const s = dec(step)
  if (s.lessThanOrEqualTo(0)) throw new Error('Rounding step must be greater than zero')
  const places = Math.max(s.decimalPlaces(), 2)
  const rounded = dec(value).div(s).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).mul(s)
  return rounded.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places)
}

/** Converts a base-currency amount into a foreign currency using "foreign per 1 base". */
export function toForeign(base: DecimalString, rate: DecimalString, scale = 2): DecimalString {
  return money(dec(base).mul(dec(rate)), scale)
}

/** Converts a foreign-currency amount back to base using "foreign per 1 base". */
export function toBase(foreign: DecimalString, rate: DecimalString, scale = 2): DecimalString {
  const r = dec(rate)
  if (r.isZero()) throw new Error('Exchange rate cannot be zero')
  return money(dec(foreign).div(r), scale)
}

export function parseDecimalInput(raw: string, { allowNegative = false, maxScale = 3 } = {}): DecimalString | null {
  const trimmed = raw.trim().replace(/,/g, '')
  if (!trimmed) return null
  const pattern = allowNegative ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/
  if (!pattern.test(trimmed)) return null
  const [, fraction = ''] = trimmed.split('.')
  if (fraction.length > maxScale) return null
  return new Decimal(trimmed).toFixed()
}

export function applyCountMode(
  current: DecimalString | null | undefined,
  incoming: DecimalString,
  mode: 'add' | 'replace',
): DecimalString {
  if (mode === 'replace') return qty(incoming)
  return qty(add(current, incoming))
}
