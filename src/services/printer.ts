import { db } from '@/db/schema'
import type { Payment, PrinterSettings, Sale, SaleLine } from '@/db/types'
import { formatAmount } from '@/lib/currency'
import { track } from '@/lib/telemetry'
import { getBridge, type PrinterTarget, type PrintResult } from './bridge'
import { drawerKickBytes, EscPos } from './escpos'
import { buildReceiptModel, type ReceiptModel } from './receipt-model'

export interface ReceiptData {
  sale: Sale
  lines: SaleLine[]
  payments: Payment[]
  storeName: string
  reprint: boolean
}

export type ReceiptRow =
  | { kind: 'center'; text: string; strong?: boolean; large?: boolean }
  | { kind: 'pair'; left: string; right: string; strong?: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'rule' }

function stamp(iso: string) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Turns the receipt model into rows. Preview and ESC/POS both print these rows and nothing else. */
export function renderReceipt(model: ReceiptModel): ReceiptRow[] {
  const rows: ReceiptRow[] = [
    { kind: 'center', text: model.storeName, strong: true },
    { kind: 'center', text: model.refund ? 'REFUND' : model.notice },
    { kind: 'rule' },
    { kind: 'pair', left: 'Receipt', right: model.receiptNumber },
    { kind: 'pair', left: 'Date', right: stamp(model.completedAt) },
    { kind: 'pair', left: 'Cashier', right: model.cashierName },
  ]
  if (model.refund && model.originalReceiptNumber) rows.push({ kind: 'pair', left: 'Original receipt', right: model.originalReceiptNumber })
  if (model.reprint) rows.push({ kind: 'center', text: '*** REPRINT ***', strong: true })
  rows.push({ kind: 'rule' })

  for (const l of model.lines) {
    rows.push({ kind: 'text', text: l.name })
    rows.push({ kind: 'pair', left: `  ${l.qty} x ${formatAmount(l.unitPrice)}`, right: formatAmount(l.amount) })
    if (l.discount) rows.push({ kind: 'pair', left: '  Discount', right: `-${formatAmount(l.discount)}` })
  }
  rows.push({ kind: 'rule' })
  if (model.discountTotal) rows.push({ kind: 'pair', left: 'Discounts', right: `-${formatAmount(model.discountTotal)}` })
  rows.push({ kind: 'pair', left: model.total.label, right: formatAmount(model.total.value), strong: true })
  rows.push({ kind: 'rule' })
  for (const p of model.payments) {
    rows.push({ kind: 'pair', left: p.label, right: formatAmount(p.value) })
    if (p.reference) rows.push({ kind: 'text', text: `  Ref ${p.reference}` })
  }
  if (model.rateNote) rows.push({ kind: 'text', text: model.rateNote })
  if (model.change) rows.push({ kind: 'pair', left: model.change.label, right: formatAmount(model.change.value), strong: true })
  if (model.refundReason) rows.push({ kind: 'text', text: `Reason: ${model.refundReason}` })
  if (model.approvedBy) rows.push({ kind: 'text', text: `Approved by ${model.approvedBy}` })
  rows.push({ kind: 'rule' })
  rows.push({ kind: 'center', text: 'Thank you for shopping with us' })
  return rows
}

export function receiptRows(data: ReceiptData): ReceiptRow[] {
  return renderReceipt(buildReceiptModel(data))
}

export function rowsToText(rows: ReceiptRow[], width: number): string[] {
  const out: string[] = []
  for (const r of rows) {
    if (r.kind === 'rule') out.push('-'.repeat(width))
    else if (r.kind === 'text') out.push(r.text.slice(0, width))
    else if (r.kind === 'center') {
      const t = r.text.slice(0, width)
      out.push(`${' '.repeat(Math.floor((width - t.length) / 2))}${t}`)
    } else {
      const space = width - r.right.length - 1
      const l = r.left.length > space ? `${r.left.slice(0, Math.max(0, space - 1))}.` : r.left
      out.push(`${l}${' '.repeat(Math.max(1, width - l.length - r.right.length))}${r.right}`)
    }
  }
  return out
}

export function receiptBytes(data: ReceiptData, width: number, openDrawer: boolean): number[] {
  const p = new EscPos(width)
  for (const r of receiptRows(data)) {
    if (r.kind === 'rule') p.rule()
    else if (r.kind === 'text') p.align('left').line(r.text)
    else if (r.kind === 'center') p.align('center').bold(!!r.strong).size(!!r.large).line(r.text).size(false).bold(false)
    else p.align('left').bold(!!r.strong).pair(r.left, r.right).bold(false)
  }
  p.feed(4).cut()
  if (openDrawer) p.raw(...drawerKickBytes())
  return p.toArray()
}

export async function loadReceiptData(saleId: string, reprint = false): Promise<ReceiptData | null> {
  const [sale, settings] = await Promise.all([db.sales.get(saleId), db.settings.get('app')])
  if (!sale) return null
  const [lines, payments] = await Promise.all([db.saleLines.where('saleId').equals(saleId).sortBy('lineNo'), db.payments.where('saleId').equals(saleId).sortBy('createdAt')])
  return { sale, lines, payments, storeName: settings?.storeName ?? 'Store', reprint }
}

function target(settings: PrinterSettings): PrinterTarget {
  return { kind: settings.kind, host: settings.host, port: settings.port, devicePath: settings.devicePath }
}

/** Last receipt sent to the mock printer, for the on-screen debug view. */
export let lastMockPrint: string[] = []

async function send(settings: PrinterSettings, bytes: number[], textPreview: string[]): Promise<PrintResult> {
  if (settings.kind === 'mock' || !getBridge()) {
    await new Promise((r) => setTimeout(r, 150))
    if (settings.mockFailure) return { ok: false, error: 'Mock printer: paper out' }
    lastMockPrint = textPreview
    return { ok: true, detail: getBridge() ? 'Mock printer (Electron)' : 'Mock printer (browser has no printer access)' }
  }
  return getBridge()!.printer.printRaw(target(settings), bytes)
}

/**
 * Prints a committed sale. Printing never creates, edits or re-commits the sale itself;
 * it only records the print outcome, so a failure cannot lose or duplicate a sale.
 */
export async function printReceipt(saleId: string, { reprint = false, openDrawer = false } = {}): Promise<PrintResult> {
  const settings = await db.settings.get('app')
  const data = await loadReceiptData(saleId, reprint)
  if (!settings || !data) return { ok: false, error: 'Receipt not found' }
  const width = settings.printer.widthChars
  let result: PrintResult
  try {
    result = await send(settings.printer, receiptBytes(data, width, openDrawer), rowsToText(receiptRows(data), width))
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : 'Printer error' }
  }
  await db.sales.update(saleId, {
    printStatus: result.ok ? 'printed' : data.sale.printCount > 0 ? 'printed' : 'failed',
    printCount: data.sale.printCount + (result.ok ? 1 : 0),
    lastPrintError: result.ok ? null : (result.error ?? 'Printer error'),
  })
  track(result.ok ? 'printer.printed' : 'printer.failed', { saleId, reprint, error: result.error }, result.ok ? 'info' : 'warn')
  return result
}

export async function openCashDrawer(): Promise<PrintResult> {
  const settings = await db.settings.get('app')
  if (!settings) return { ok: false, error: 'Settings missing' }
  if (settings.printer.kind === 'mock' || !getBridge()) {
    if (settings.printer.mockFailure) return { ok: false, error: 'Mock printer: offline' }
    return { ok: true, detail: 'Mock drawer opened' }
  }
  try {
    return await getBridge()!.printer.openDrawer(target(settings.printer))
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Drawer error' }
  }
}
