import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { db } from '@/db/schema'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { qty, variancePct, qtyString } from '@/lib/decimal'
import { downloadTextFile } from '@/lib/utils'
import { useAuthStore } from '@/features/auth/auth-store'
import { canReviewVariances, canSeeExpected } from '@/lib/permissions'
import { EmptyState } from '@/components/EmptyState'
import { ShieldAlert } from 'lucide-react'

type Filter = 'all' | 'large' | 'missing' | 'zero'

export function VariancesPage() {
  const role = useAuthStore((s) => s.session?.role ?? 'counter')
  const [params, setParams] = useSearchParams()
  const stocktakes = useLiveQuery(() => db.stocktakes.toArray(), []) ?? []
  const selectedId = params.get('stocktake') ?? stocktakes.find((s) => s.status === 'submitted')?.id ?? stocktakes[0]?.id
  const stocktake = stocktakes.find((s) => s.id === selectedId)
  const lines =
    useLiveQuery(
      () => (selectedId ? db.stocktakeLines.where('stocktakeId').equals(selectedId).toArray() : []),
      [selectedId],
    ) ?? []
  const products = useLiveQuery(() => db.products.toArray(), []) ?? []
  const [filter, setFilter] = useState<Filter>('all')

  const rows = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p]))
    return lines
      .map((l) => {
        const expected = l.expectedQty
        const counted = l.countedQty
        const difference =
          expected != null && counted != null ? qtyString(qty(counted).minus(qty(expected))) : null
        const percentage = variancePct(expected, counted)
        return {
          ...l,
          product: map.get(l.productId),
          difference,
          percentage,
        }
      })
      .filter((r) => {
        if (filter === 'missing') return r.countedQty == null
        if (filter === 'zero') return r.countedQty != null && qty(r.countedQty).isZero()
        if (filter === 'large')
          return r.percentage != null && Math.abs(r.percentage) >= 10
        return true
      })
  }, [lines, products, filter])

  if (!canReviewVariances(role)) {
    return (
      <div className="p-6">
        <EmptyState
          icon={ShieldAlert}
          title="Variance review restricted"
          description="Counters cannot review expected quantities on blind sessions."
        />
      </div>
    )
  }

  const showExpected = stocktake ? canSeeExpected(role, stocktake.blind) : true

  function exportCsv() {
    const header = 'sku,name,location,expected,counted,difference,percentage\n'
    const body = rows
      .map((r) =>
        [
          r.product?.sku ?? '',
          JSON.stringify(r.product?.name ?? ''),
          r.locationId,
          showExpected ? r.expectedQty ?? '' : '',
          r.countedQty ?? '',
          r.difference ?? '',
          r.percentage ?? '',
        ].join(','),
      )
      .join('\n')
    downloadTextFile(`variances-${selectedId}.csv`, header + body, 'text/csv')
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Variance review</h1>
          <p className="text-sm text-muted">Server is authoritative once approve/post are wired.</p>
        </div>
        <Button variant="secondary" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className="min-h-11 rounded-md border border-border bg-card px-3"
          value={selectedId ?? ''}
          onChange={(e) => setParams({ stocktake: e.target.value })}
        >
          {stocktakes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.status})
            </option>
          ))}
        </select>
        {(['all', 'large', 'missing', 'zero'] as Filter[]).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'default' : 'secondary'}
            onClick={() => setFilter(f)}
          >
            {f}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{stocktake?.name ?? 'Stocktake'}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase text-muted">
              <tr>
                <th className="py-2">Product</th>
                <th className="py-2">Location</th>
                {showExpected && <th className="py-2">Expected</th>}
                <th className="py-2">Counted</th>
                {showExpected && <th className="py-2">Diff</th>}
                {showExpected && <th className="py-2">%</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2">
                    <div>{r.product?.name}</div>
                    <div className="font-mono text-xs text-muted">{r.product?.sku}</div>
                  </td>
                  <td className="py-2">{r.locationId}</td>
                  {showExpected && <td className="py-2 tabular-nums">{r.expectedQty ?? '—'}</td>}
                  <td className="py-2 tabular-nums">{r.countedQty ?? '—'}</td>
                  {showExpected && (
                    <td className="py-2 tabular-nums">
                      {r.difference ?? '—'}{' '}
                      {r.percentage != null && Math.abs(r.percentage) >= 10 && (
                        <Badge variant="warning">large</Badge>
                      )}
                    </td>
                  )}
                  {showExpected && (
                    <td className="py-2 tabular-nums">
                      {r.percentage == null ? '—' : `${r.percentage.toFixed(1)}%`}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-6 text-sm text-muted">No rows for this filter.</p>}
        </CardContent>
      </Card>
    </div>
  )
}
