import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { db } from '@/db/schema'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SyncStatusBadge } from '@/components/SyncStatusBadge'
import { formatDateTime } from '@/lib/utils'
import { recordCount } from '@/services/count-service'
import { isValidQuantityInput } from '@/lib/decimal'

export function CountHistoryPage() {
  const { stocktakeId } = useParams()
  const [q, setQ] = useState('')
  const events =
    useLiveQuery(
      async () =>
        stocktakeId
          ? (await db.countEvents.where('stocktakeId').equals(stocktakeId).toArray()).sort((a, b) =>
              a.observedAt.localeCompare(b.observedAt),
            )
          : [],
      [stocktakeId],
    ) ?? []
  const products = useLiveQuery(() => db.products.toArray(), []) ?? []
  const stocktake = useLiveQuery(
    () => (stocktakeId ? db.stocktakes.get(stocktakeId) : undefined),
    [stocktakeId],
  )
  const map = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const filtered = events
    .slice()
    .reverse()
    .filter((ev) => {
      if (!q.trim()) return true
      const p = map.get(ev.productId)
      const needle = q.toLowerCase()
      return (
        p?.name.toLowerCase().includes(needle) ||
        p?.sku.toLowerCase().includes(needle) ||
        ev.id.includes(needle)
      )
    })

  async function correct(productId: string) {
    const raw = window.prompt('Enter corrective quantity (replace mode)')
    if (raw == null) return
    if (!isValidQuantityInput(raw) || !stocktakeId || !stocktake) {
      toast.error('Invalid quantity')
      return
    }
    await recordCount({
      stocktakeId,
      productId,
      locationId: stocktake.locationId,
      quantity: raw,
      mode: 'replace',
      baseVersion: stocktake.version,
    })
    toast.success('Corrective event saved locally')
  }

  return (
    <div className="space-y-3 p-4">
      <Button asChild variant="ghost">
        <Link to={`/count/${stocktakeId}`}>← Scanner</Link>
      </Button>
      <h1 className="text-xl font-bold">Count history & queue</h1>
      <Input
        placeholder="Search product or event"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="space-y-2">
        {filtered.map((ev) => {
          const p = map.get(ev.productId)
          return (
            <div key={ev.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{p?.name ?? ev.productId}</p>
                  <p className="text-xs text-muted">
                    {ev.quantity} · {ev.mode} · seq {ev.deviceSequence}
                  </p>
                  <p className="text-xs text-muted">{formatDateTime(ev.observedAt)}</p>
                  {ev.lastError && <p className="text-xs text-danger">{ev.lastError}</p>}
                </div>
                <SyncStatusBadge status={ev.syncStatus} />
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() => void correct(ev.productId)}
              >
                Correct (new event)
              </Button>
            </div>
          )
        })}
        {filtered.length === 0 && <p className="text-sm text-muted">No events.</p>}
      </div>
    </div>
  )
}
