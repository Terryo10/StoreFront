import { useMemo, useState } from 'react'
import { History, Printer } from 'lucide-react'
import { useOpenShift } from '@/app/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, Segmented, Skeleton } from '@/components/ui/misc'
import { StatusChip } from '@/components/ui/status-chip'
import { db } from '@/db/schema'
import type { Sale, SyncState } from '@/db/types'
import { formatAmount, formatMoney } from '@/lib/currency'
import { sum } from '@/lib/decimal'
import { useLive } from '@/lib/use-live'
import { cn, formatTime } from '@/lib/utils'
import { actorOf, useAuth } from '@/features/auth/auth-store'
import { ReceiptDialog } from '@/features/payments/ReceiptDialog'

type Filter = 'all' | 'unsynced' | 'problems' | 'refunds'

export function HistoryPage() {
  const session = useAuth((s) => s.session)!
  const shift = useOpenShift()
  const lastShift = useLive(async () => (await db.shifts.orderBy('openedAt').reverse().first()) ?? null, [])
  const shown = shift ?? lastShift ?? null
  const sales = useLive(() => (shown ? db.sales.where('shiftId').equals(shown.id).reverse().sortBy('completedAt') : Promise.resolve([] as Sale[])), [shown?.id])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase()
    const problems: SyncState[] = ['rejected', 'conflict']
    return (sales ?? []).filter((s) => {
      if (q && !s.receiptNumber.includes(q) && !s.cashierName.toUpperCase().includes(q) && !s.total.includes(q)) return false
      if (filter === 'unsynced') return s.syncState !== 'synced'
      if (filter === 'problems') return problems.includes(s.syncState) || s.printStatus === 'failed'
      if (filter === 'refunds') return s.kind === 'refund'
      return true
    })
  }, [sales, query, filter])

  const salesTotal = sum((sales ?? []).filter((s) => s.kind === 'sale').map((s) => s.total))
  const refundTotal = sum((sales ?? []).filter((s) => s.kind === 'refund').map((s) => s.total))

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-4 border-b border-rule bg-surface px-5 py-3">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">{shown ? `Shift ${shown.number} history` : 'Sales history'}</h1>
          {shown && (
            <p className="tnum text-sm text-ink-soft">
              {shown.status === 'open' ? 'Open since' : 'Closed shift, opened'} {formatTime(shown.openedAt)}. Sales {formatMoney(salesTotal, 'USD')}, refunds {formatMoney(refundTotal, 'USD')}
            </p>
          )}
        </div>
        <Input aria-label="Search receipts" placeholder="Receipt number, cashier or amount" value={query} onChange={(e) => setQuery(e.target.value)} className="w-72" />
        <Segmented<Filter>
          label="Filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unsynced', label: 'Not synced' },
            { value: 'problems', label: 'Problems' },
            { value: 'refunds', label: 'Refunds' },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sales === undefined ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={History} title={sales.length === 0 ? 'No sales in this shift yet' : 'Nothing matches'} className="h-full">
            {sales.length === 0 ? 'Completed sales and refunds appear here with their sync status.' : 'Clear the search or choose another filter.'}
          </EmptyState>
        ) : (
          <table className="w-full bg-surface">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-rule text-left text-sm text-ink-soft">
                <th className="px-5 py-2 font-medium">Receipt</th>
                <th className="py-2 font-medium">Time</th>
                <th className="py-2 font-medium">Cashier</th>
                <th className="py-2 text-right font-medium">Total US$</th>
                <th className="py-2 pl-6 font-medium">Server</th>
                <th className="py-2 font-medium">Printer</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-rule hover:bg-sunk">
                  <td className="tnum px-5 py-2.5 font-medium">
                    {s.receiptNumber}
                    {s.kind === 'refund' && <span className="ml-2 rounded bg-st-conflict-bg px-1.5 py-0.5 text-xs font-medium text-st-conflict">Refund of {s.originalReceiptNumber}</span>}
                  </td>
                  <td className="tnum py-2.5 text-ink-soft">{formatTime(s.completedAt)}</td>
                  <td className="py-2.5 text-ink-soft">{s.cashierName}</td>
                  <td className={cn('tnum py-2.5 text-right font-semibold', s.kind === 'refund' && 'text-st-conflict')}>
                    {s.kind === 'refund' ? '−' : ''}
                    {formatAmount(s.total)}
                  </td>
                  <td className="py-2.5 pl-6">
                    <StatusChip state={s.syncState} size="sm" />
                    {s.syncError && s.syncState !== 'synced' && (
                      <p className="mt-0.5 max-w-56 truncate text-xs text-ink-soft" title={s.syncError}>
                        {s.syncError}
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 text-sm">
                    {s.printStatus === 'failed' ? <span className="font-medium text-st-rejected">Not printed</span> : s.printCount > 0 ? <span className="text-ink-soft">Printed{s.printCount > 1 ? ` ×${s.printCount}` : ''}</span> : <span className="text-ink-soft">Not printed</span>}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <Button size="sm" variant="secondary" onClick={() => setOpenId(s.id)}>
                      <Printer className="size-4" /> View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ReceiptDialog saleId={openId} autoPrint={false} kickDrawer={false} actor={actorOf(session)} closeLabel="Close" heading="Receipt" onClose={() => setOpenId(null)} />
    </div>
  )
}
