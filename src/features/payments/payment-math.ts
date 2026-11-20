import Decimal from 'decimal.js'
import type { PaymentMethod } from '@/db/types'
import { BASE_CURRENCY, type CurrencyCode } from '@/lib/currency'
import { dec, money, toBase, type DecimalString } from '@/lib/decimal'

export interface TenderDraft {
  id: string
  method: PaymentMethod
  currency: CurrencyCode
  amount: DecimalString
  reference: string | null
}

export interface TenderLine extends TenderDraft {
  rate: DecimalString
  baseAmount: DecimalString
}

/** `rates` are foreign units per 1 base unit; the base currency is always "1". */
export type Rates = Partial<Record<CurrencyCode, DecimalString>>

export function rateFor(currency: CurrencyCode, rates: Rates): DecimalString {
  if (currency === BASE_CURRENCY) return '1'
  const r = rates[currency]
  if (!r || dec(r).lessThanOrEqualTo(0)) throw new Error(`No exchange rate set for ${currency}`)
  return r
}

export function toTenderLine(draft: TenderDraft, rates: Rates): TenderLine {
  const rate = rateFor(draft.currency, rates)
  return { ...draft, rate, baseAmount: draft.currency === BASE_CURRENCY ? money(draft.amount) : toBase(draft.amount, rate) }
}

/** Amount needed in `currency` to cover `baseDue`, rounded up so the tender never falls short. */
export function dueIn(baseDue: DecimalString, currency: CurrencyCode, rates: Rates): DecimalString {
  const rate = rateFor(currency, rates)
  if (dec(baseDue).lessThanOrEqualTo(0)) return '0.00'
  return dec(baseDue).mul(dec(rate)).toDecimalPlaces(2, Decimal.ROUND_UP).toFixed(2)
}

export interface PaymentSummary {
  paidBase: DecimalString
  remainingBase: DecimalString
  overpaidBase: DecimalString
  changeCurrency: CurrencyCode
  changeDue: DecimalString
  settled: boolean
  error: string | null
}

/**
 * Change can only come from cash. Card and mobile money must not exceed what is still owed
 * when they are added, so any overpayment is covered by the cash tendered.
 */
export function summarisePayments(totalBase: DecimalString, tenders: TenderLine[], rates: Rates): PaymentSummary {
  // Unrounded base values: rounding each foreign tender to cents first would short-change customers.
  const exactBase = (t: TenderLine) => (t.currency === BASE_CURRENCY ? dec(t.amount) : dec(t.amount).div(dec(t.rate)))
  const paid = tenders.reduce((acc, t) => acc.plus(exactBase(t)), new Decimal(0))
  const total = dec(totalBase)
  const remaining = Decimal.max(total.minus(paid), 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  const overpaid = Decimal.max(paid.minus(total), 0)
  const lastCash = [...tenders].reverse().find((t) => t.method === 'cash')
  const changeCurrency = lastCash?.currency ?? BASE_CURRENCY

  let error: string | null = null
  const cashBase = tenders.filter((t) => t.method === 'cash').reduce((acc, t) => acc.plus(exactBase(t)), new Decimal(0))
  if (overpaid.greaterThan(0) && overpaid.greaterThan(cashBase)) {
    error = 'Card and mobile money cannot be more than the amount owed'
  }

  // Snap to 8 places first so division residue (22.2799999…) cannot round a cent away.
  const toCents = (d: Decimal) => d.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2)
  const changeDue = overpaid.greaterThan(0) && changeCurrency !== BASE_CURRENCY ? toCents(overpaid.mul(dec(rateFor(changeCurrency, rates)))) : toCents(overpaid)

  return {
    paidBase: money(paid),
    remainingBase: money(remaining),
    overpaidBase: money(overpaid),
    changeCurrency,
    changeDue,
    settled: remaining.lessThanOrEqualTo(0) && error === null,
    error,
  }
}

export function validateTender(draft: TenderDraft, remainingBase: DecimalString, rates: Rates): string | null {
  const amount = dec(draft.amount)
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) return 'Enter an amount greater than zero'
  if (draft.method !== 'cash') {
    if (!draft.reference || draft.reference.trim().length < 3) {
      return draft.method === 'card' ? 'Enter the card terminal reference' : 'Enter the mobile money transaction reference'
    }
    const line = toTenderLine(draft, rates)
    if (dec(line.baseAmount).greaterThan(dec(remainingBase))) {
      return 'Card and mobile money cannot be more than the amount owed'
    }
  }
  return null
}

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_money: 'Mobile money',
}
