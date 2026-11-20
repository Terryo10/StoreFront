import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ClipboardList, EyeOff, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState, Skeleton } from '@/components/ui/misc'
import { db } from '@/db/schema'
import type { Stocktake } from '@/db/types'
import { useLive } from '@/lib/use-live'
import { useAuth } from '@/features/auth/auth-store'
import { listStocktakesFor, refreshStocktakes, startCounting, STOCKTAKE_STATUS_LABEL } from './count-service'

export function CountListPage() {
  const session = useAuth((s) => s.session)!
  const navigate = useNavigate()
  const stocktakes = useLive(() => listStocktakesFor(session.role, session.userId), [session.role, session.userId])
  const counts = useLive(async () => {
    const all = await db.countEvents.toArray()
    const m = new Map<string, number>()
    for (const e of all) m.set(e.stocktakeId, (m.get(e.stocktakeId) ?? 0) + 1)
    return m
  }, [])
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    void refreshStocktakes()
  }, [])

  async function open(st: Stocktake) {
    if (st.status === 'assigned' || st.status === 'open') {
      const r = await startCounting(st.id)
      if (r.note) toast.warning(r.note)
    }
    navigate(`/count/${st.id}`)
  }

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stock counts</h1>
          <p className="text-ink-soft">Counts save on this device first and sync when the server is reachable.</p>
        </div>
        <Button
          variant="secondary"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true)
            const r = await refreshStocktakes()
            setRefreshing(false)
            if (r.ok) toast.success(r.message)
            else toast.error(r.message)
          }}
        >
          <RefreshCw className={refreshing ? 'animate-spin' : ''} /> Check for new counts
        </Button>
      </div>

      {stocktakes === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : stocktakes.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No stock counts assigned">
          A supervisor creates counts in the back office. Check again once the server is reachable.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {stocktakes.map((st) => {
            const done = st.status === 'submitted_local' || st.status === 'submitted'
            return (
              <li key={st.id} className="flex items-center justify-between gap-4 rounded-lg border border-rule bg-surface px-4 py-3">
                <div>
                  <p className="text-[16px] font-semibold">{st.name}</p>
                  <p className="text-sm text-ink-soft">
                    {st.locationName}, {STOCKTAKE_STATUS_LABEL[st.status].toLowerCase()}
                    {counts?.get(st.id) ? `, ${counts.get(st.id)} scans on this device` : ''}
                  </p>
                  {st.blind && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[13px] text-st-local">
                      <EyeOff className="size-3.5" /> Blind count
                    </p>
                  )}
                </div>
                {done ? (
                  <Button variant="secondary" asChild>
                    <Link to={`/count/${st.id}`}>View</Link>
                  </Button>
                ) : (
                  <Button onClick={() => void open(st)}>{st.status === 'counting' ? 'Continue counting' : 'Start counting'}</Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
