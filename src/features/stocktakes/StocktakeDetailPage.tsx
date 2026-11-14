import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { db } from '@/db/schema'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/features/auth/auth-store'
import { canApprove, canPost, canReviewVariances, canSeeExpected } from '@/lib/permissions'
import { createId } from '@/lib/ids'
import { SyncStatusBadge } from '@/components/SyncStatusBadge'

export function StocktakeDetailPage() {
  const { id } = useParams()
  const role = useAuthStore((s) => s.session?.role ?? 'counter')
  const stocktake = useLiveQuery(() => (id ? db.stocktakes.get(id) : undefined), [id])
  const lines = useLiveQuery(
    () => (id ? db.stocktakeLines.where('stocktakeId').equals(id).toArray() : []),
    [id],
  ) ?? []
  const events =
    useLiveQuery(
      async () =>
        id
          ? (await db.countEvents.where('stocktakeId').equals(id).toArray()).sort((a, b) =>
              a.observedAt.localeCompare(b.observedAt),
            )
          : [],
      [id],
    ) ?? []
  const products = useLiveQuery(() => db.products.toArray(), []) ?? []
  const productMap = new Map(products.map((p) => [p.id, p]))

  if (!stocktake) {
    return <div className="p-6 text-sm text-muted">Loading stocktake…</div>
  }

  const showExpected = canSeeExpected(role, stocktake.blind)
  const counted = lines.filter((l) => l.countedQty != null).length

  async function patchStatus(
    status: 'counting' | 'submitted' | 'approved' | 'posted',
    action: string,
  ) {
    if (!stocktake || !id) return
    if (status === 'submitted') {
      const pending = await db.outbox
        .where('stocktakeId')
        .equals(id)
        .filter((e) => e.status === 'pending' || e.status === 'syncing')
        .count()
      const settings = await db.settings.get('app')
      // Never claim server approval while offline / unsynced
      if (pending > 0 || settings?.apiMode === 'mock') {
        toast.message('Submitted locally only', {
          description: `${pending} events still pending sync. Not marked as server-approved.`,
        })
      }
    }

    const now = new Date().toISOString()
    const audit = [
      ...stocktake.audit,
      {
        id: createId(),
        at: now,
        actor: useAuthStore.getState().session?.name ?? 'user',
        action,
        detail:
          status === 'submitted'
            ? 'Local submit — server acceptance requires successful sync + POST /submit'
            : `Local ${action}`,
        source: 'local' as const,
      },
    ]

    await db.stocktakes.update(id, {
      status,
      startedAt: status === 'counting' ? stocktake.startedAt ?? now : stocktake.startedAt,
      submittedAt: status === 'submitted' ? now : stocktake.submittedAt,
      approvedAt: status === 'approved' ? now : stocktake.approvedAt,
      postedAt: status === 'posted' ? now : stocktake.postedAt,
      serverState: 'local-only',
      audit,
    })
    toast.success(`${action} saved locally (not server-authoritative yet)`)
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Button asChild variant="ghost">
        <Link to="/stocktakes">← Stocktakes</Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{stocktake.name}</h1>
          <p className="text-sm text-muted">
            {stocktake.branchName} · {stocktake.locationName} · {stocktake.scope}
            {stocktake.blind ? ' · blind' : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge>{stocktake.status}</Badge>
            <Badge variant="muted">{stocktake.serverState}</Badge>
            {stocktake.staleInventory && <Badge variant="warning">Stale inventory</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {stocktake.status === 'draft' && (
            <Button onClick={() => void patchStatus('counting', 'started')}>Start counting</Button>
          )}
          {(stocktake.status === 'draft' || stocktake.status === 'counting') && (
            <Button asChild variant="secondary">
              <Link to={`/count/${stocktake.id}`}>Open counter</Link>
            </Button>
          )}
          {stocktake.status === 'counting' && (
            <Button variant="secondary" onClick={() => void patchStatus('submitted', 'submitted')}>
              Submit session
            </Button>
          )}
          {stocktake.status === 'submitted' && canApprove(role) && (
            <Button
              onClick={() => {
                if (stocktake.staleInventory) {
                  toast.warning('Stale inventory warning: server is authoritative once wired.')
                }
                void patchStatus('approved', 'approved')
              }}
            >
              Approve
            </Button>
          )}
          {stocktake.status === 'approved' && canPost(role) && (
            <Button onClick={() => void patchStatus('posted', 'posted')}>Post</Button>
          )}
          {canReviewVariances(role) && (
            <Button asChild variant="outline">
              <Link to={`/variances?stocktake=${stocktake.id}`}>Variances</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Progress</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="text-3xl font-bold tabular-nums">
              {counted}/{lines.length}
            </p>
            <p className="text-muted">products counted</p>
            <p className="mt-2">Assigned counters: <em>future-ready (no enrollment API)</em></p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Audit timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {stocktake.audit
              .slice()
              .reverse()
              .map((a) => (
                <div key={a.id} className="border-b border-border pb-2">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{a.action}</span>
                    <span className="text-xs text-muted">{formatDateTime(a.at)}</span>
                  </div>
                  <p className="text-muted">
                    {a.actor}: {a.detail}
                  </p>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-muted">
              <tr>
                <th className="py-2">Product</th>
                {showExpected && <th className="py-2">Expected</th>}
                <th className="py-2">Counted</th>
                <th className="py-2">Events</th>
              </tr>
            </thead>
            <tbody>
              {lines.slice(0, 100).map((l) => {
                const p = productMap.get(l.productId)
                return (
                  <tr key={l.id} className="border-t border-border">
                    <td className="py-2">
                      <div>{p?.name ?? l.productId}</div>
                      <div className="font-mono text-xs text-muted">{p?.sku}</div>
                    </td>
                    {showExpected && (
                      <td className="py-2 tabular-nums">{l.expectedQty ?? '—'}</td>
                    )}
                    <td className="py-2 tabular-nums">{l.countedQty ?? '—'}</td>
                    <td className="py-2">{l.countEventCount}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!showExpected && (
            <p className="mt-2 text-xs text-muted">
              Expected quantities hidden (blind count / counter role).
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent count events</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {events
            .slice()
            .reverse()
            .slice(0, 30)
            .map((ev) => (
              <div key={ev.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2">
                <div>
                  <p className="font-medium">
                    {productMap.get(ev.productId)?.name ?? ev.productId} · {ev.quantity} ({ev.mode})
                  </p>
                  <p className="text-xs text-muted">
                    seq {ev.deviceSequence} · {formatDateTime(ev.observedAt)}
                  </p>
                </div>
                <SyncStatusBadge status={ev.syncStatus} />
              </div>
            ))}
          {events.length === 0 && <p className="text-muted">No counts yet.</p>}
        </CardContent>
      </Card>
    </div>
  )
}
