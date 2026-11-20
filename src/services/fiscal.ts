import type { Sale, SaleLine } from '@/db/types'

/**
 * Fiscalisation extension point (ZIMRA fiscal devices are out of scope for V1).
 *
 * `prepare` runs BEFORE the IndexedDB transaction, because a device call is async I/O and
 * would close an open IndexedDB transaction. Whatever it returns is stored on `sale.fiscal`
 * and included in the `sale.completed` payload. `afterCommit` runs once the sale is durable.
 * A throwing `prepare` aborts the sale before anything is written.
 */
export interface FiscalDraft {
  kind: Sale['kind']
  receiptNumber: string
  total: string
  currency: string
  lines: Array<Pick<SaleLine, 'sku' | 'name' | 'qty' | 'unitPrice' | 'discount' | 'lineTotal'>>
}

export interface FiscalHook {
  name: string
  prepare?: (draft: FiscalDraft) => Promise<Record<string, unknown> | null>
  afterCommit?: (sale: Sale) => Promise<void>
}

let hook: FiscalHook | null = null

export function registerFiscalHook(next: FiscalHook | null) {
  hook = next
}

export async function fiscalPrepare(draft: FiscalDraft): Promise<Record<string, unknown> | null> {
  return hook?.prepare ? hook.prepare(draft) : null
}

export async function fiscalAfterCommit(sale: Sale): Promise<void> {
  if (!hook?.afterCommit) return
  try {
    await hook.afterCommit(sale)
  } catch (err) {
    console.error('Fiscal afterCommit failed; the sale remains committed', err)
  }
}
