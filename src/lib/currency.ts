import { money, type DecimalString } from './decimal'

export type CurrencyCode = 'USD' | 'ZWG'

export interface CurrencyDef {
  code: CurrencyCode
  label: string
  symbol: string
  scale: number
}

export const CURRENCIES: Record<CurrencyCode, CurrencyDef> = {
  USD: { code: 'USD', label: 'US dollar', symbol: 'US$', scale: 2 },
  ZWG: { code: 'ZWG', label: 'Zimbabwe Gold (ZiG)', symbol: 'ZiG', scale: 2 },
}

export const BASE_CURRENCY: CurrencyCode = 'USD'

export function formatMoney(value: DecimalString | null | undefined, currency: CurrencyCode = BASE_CURRENCY): string {
  const def = CURRENCIES[currency]
  const fixed = money(value ?? '0', def.scale)
  const negative = fixed.startsWith('-')
  const [whole, fraction] = (negative ? fixed.slice(1) : fixed).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '−' : ''}${def.symbol} ${grouped}${fraction ? `.${fraction}` : ''}`
}

export function formatAmount(value: DecimalString | null | undefined, scale = 2): string {
  const fixed = money(value ?? '0', scale)
  const negative = fixed.startsWith('-')
  const [whole, fraction] = (negative ? fixed.slice(1) : fixed).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '−' : ''}${grouped}${fraction ? `.${fraction}` : ''}`
}
