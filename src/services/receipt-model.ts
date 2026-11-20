import type { Payment, ReceiptCurrency, Sale, SaleLine } from '@/db/types'
import type { CurrencyCode } from '@/lib/currency'
import { dec, money, roundToStep, type DecimalString } from '@/lib/decimal'
import { METHOD_LABELS } from '@/features/payments/payment-math'

/**
 * One line the customer can read on 58mm paper (32 columns).
 * "Tax invoice not issued: provisional receipt" was 46 characters and got cut off.
 */
export const RECEIPT_NOTICE = 'Provisional, not a tax invoice'

export interface ReceiptSource {
  sale: Sale
  lines: SaleLine[]
  payments: Payment[]
  storeName: string
  reprint?: boolean
}

export interface ReceiptLineModel {
  name: string
  qty: string
  /** Decimal string in the currency this line is printed in. */
  unitPrice: DecimalString
  /** Decimal string printed on the right. ZiG lines sum to the ZiG total. */
  amount: DecimalString
  discount: DecimalString | null
}

export interface ReceiptModel {
  receiptCurrency: ReceiptCurrency
  storeName: string
  notice: string
  refund: boolean
  reprint: boolean
  receiptNumber: string
  completedAt: string
  cashierName: string
  originalReceiptNumber: string | null
  lines: ReceiptLineModel[]
  /** Set when the printed line amounts are gross and discounts are shown underneath. */
  discountTotal: DecimalString | null
  total: { label: string; value: DecimalString; currency: CurrencyCode }
  payments: Array<{ label: string; value: DecimalString; reference: string | null }>
  change: { label: string; value: DecimalString } | null
  /** Present only for a split tender, e.g. "Rate 1 USD = 26.8000 ZiG". */
  rateNote: string | null
  refundReason: string | null
  approvedBy: string | null
}

export function receiptCurrencyOf(currencies: CurrencyCode[]): ReceiptCurrency {
  const used = new Set(currencies)
  if (used.size === 1 && used.has('USD')) return 'USD'
  if (used.size === 1 && used.has('ZWG')) return 'ZiG'
  return 'SPLIT'
}

export function paperCurrency(code: CurrencyCode): 'USD' | 'ZiG' {
  return code === 'ZWG' ? 'ZiG' : 'USD'
}

/**
 * Converts each net USD line at `rate`, rounds to `step`, then moves the rounding
 * difference onto the last line so the lines add up to the once-rounded total.
 */
export function allocateZigAmounts(lineNetsUsd: DecimalString[], totalUsd: DecimalString, rate: DecimalString, step: DecimalString): { zigTotal: DecimalString; amounts: DecimalString[] } {
  const zigTotal = roundToStep(dec(totalUsd).mul(dec(rate)), step)
  if (lineNetsUsd.length === 0) return { zigTotal, amounts: [] }
  const amounts = lineNetsUsd.map((net) => roundToStep(dec(net).mul(dec(rate)), step))
  const head = amounts.slice(0, -1).reduce((acc, v) => acc.plus(dec(v)), dec(0))
  amounts[amounts.length - 1] = money(dec(zigTotal).minus(head))
  return { zigTotal, amounts }
}

export function formatRate(rate: DecimalString): string {
  return dec(rate).toDecimalPlaces(4).toFixed(4)
}

function sortedLines(lines: SaleLine[]): SaleLine[] {
  return [...lines].sort((a, b) => a.lineNo - b.lineNo)
}

/** Pure: reads only the sale, its lines and its payments. Reprints cannot drift. */
export function buildReceiptModel(source: ReceiptSource): ReceiptModel {
  const { sale, payments, storeName } = source
  const lines = sortedLines(source.lines)
  const rate = sale.rateSnapshot || sale.exchangeRate
  const step = sale.zigRoundingStep || '0.05'
  const baseTotal = sale.baseTotalUsd || sale.total
  const currency = sale.receiptCurrency || receiptCurrencyOf(payments.map((p) => p.currency))
  const showZigLines = currency === 'ZiG'
  const allocated = allocateZigAmounts(lines.map((l) => l.lineTotal), baseTotal, rate, step)

  const modelLines: ReceiptLineModel[] = lines.map((l, i) => {
    if (showZigLines) {
      return {
        name: l.name,
        qty: l.qty,
        unitPrice: l.zigUnitPrice || roundToStep(dec(l.unitPrice).mul(dec(rate)), step),
        amount: l.zigAmount || allocated.amounts[i] || '0.00',
        // The ZiG amount is already net of discount, so the paper does not subtract it again.
        discount: null,
      }
    }
    return {
      name: l.name,
      qty: l.qty,
      unitPrice: l.unitPrice,
      amount: money(dec(l.qty).mul(dec(l.unitPrice))),
      discount: dec(l.discount).greaterThan(0) ? l.discount : null,
    }
  })

  const totalValue = showZigLines ? sale.zigTotal || allocated.zigTotal : baseTotal
  const totalCurrency: CurrencyCode = showZigLines ? 'ZWG' : 'USD'
  const totalLabel = `${sale.kind === 'refund' ? 'REFUND TOTAL' : 'TOTAL'} ${paperCurrency(totalCurrency)}`

  return {
    receiptCurrency: currency,
    storeName,
    notice: RECEIPT_NOTICE,
    refund: sale.kind === 'refund',
    reprint: !!source.reprint,
    receiptNumber: sale.receiptNumber,
    completedAt: sale.completedAt,
    cashierName: sale.cashierName,
    originalReceiptNumber: sale.originalReceiptNumber,
    lines: modelLines,
    discountTotal: !showZigLines && dec(sale.discountTotal).greaterThan(0) ? sale.discountTotal : null,
    total: { label: totalLabel, value: totalValue, currency: totalCurrency },
    payments: [...payments]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((p) => ({
        label: `${METHOD_LABELS[p.method]} ${paperCurrency(p.currency)}`,
        value: p.amount,
        reference: p.reference,
      })),
    change: dec(sale.changeDue).greaterThan(0) ? { label: `Change ${paperCurrency(sale.changeCurrency)}`, value: sale.changeDue } : null,
    rateNote: currency === 'SPLIT' ? `Rate 1 USD = ${formatRate(rate)} ZiG` : null,
    refundReason: sale.refundReason,
    approvedBy: sale.approvedBy,
  }
}
