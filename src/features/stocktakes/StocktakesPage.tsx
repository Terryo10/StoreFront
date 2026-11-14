import { Link } from 'react-router-dom'
import { ClipboardList, Plus } from 'lucide-react'
import { db } from '@/db/schema'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/features/auth/auth-store'
import { canCreateStocktake } from '@/lib/permissions'
import type { StocktakeStatus } from '@/domain/types'
import { useState } from 'react'

const STATUS_VARIANT: Record<
  StocktakeStatus,
  'muted' | 'default' | 'warning' | 'success' | 'info' | 'danger'
> = {
  draft: 'muted',
  counting: 'info',
  submitted: 'warning',
  approved: 'success',
  posted: 'default',
}

export function StocktakesPage() {
  const role = useAuthStore((s) => s.session?.role ?? 'counter')
  const stocktakes = useLiveQuery(() => db.stocktakes.orderBy('createdAt').reverse().toArray(), []) ?? []
  const [status, setStatus] = useState<'all' | StocktakeStatus>('all')

  const filtered =
    status === 'all' ? stocktakes : stocktakes.filter((s) => s.status === status)

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Stocktakes</h1>
          <p className="text-sm text-muted">Draft → counting → submitted → approved → posted</p>
        </div>
        {canCreateStocktake(role) && (
          <Button asChild>
            <Link to="/stocktakes/new">
              <Plus className="h-4 w-4" /> Create stocktake
            </Link>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {(['all', 'draft', 'counting', 'submitted', 'approved', 'posted'] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? 'default' : 'secondary'}
            onClick={() => setStatus(s)}
          >
            {s}
          </Button>
        ))}
      </div>

      <div className="overflow-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-background text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Branch</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Blind</th>
              <th className="px-3 py-2">Server</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="border-b border-border hover:bg-background">
                <td className="px-3 py-2">
                  <Link className="font-medium text-accent hover:underline" to={`/stocktakes/${s.id}`}>
                    {s.name}
                  </Link>
                </td>
                <td className="px-3 py-2">{s.branchName}</td>
                <td className="px-3 py-2">
                  <Badge variant={STATUS_VARIANT[s.status]}>{s.status}</Badge>
                </td>
                <td className="px-3 py-2">{s.blind ? 'Yes' : 'No'}</td>
                <td className="px-3 py-2">
                  <Badge variant="muted">{s.serverState}</Badge>
                </td>
                <td className="px-3 py-2">{formatDateTime(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <EmptyState
            icon={ClipboardList}
            title="No stocktakes"
            description="Create a session to begin counting."
            className="m-4"
            action={
              canCreateStocktake(role) ? (
                <Button asChild>
                  <Link to="/stocktakes/new">Create stocktake</Link>
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  )
}
