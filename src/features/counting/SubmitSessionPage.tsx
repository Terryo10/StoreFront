import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { db } from '@/db/schema'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { processOutbox, getSyncSnapshot } from '@/services/sync-engine'
import { useEffect, useState } from 'react'
import { probeServer } from '@/lib/connectivity'
import { useSettingsStore } from '@/features/settings/settings-store'
import { createId } from '@/lib/ids'
import { useAuthStore } from '@/features/auth/auth-store'

export function SubmitSessionPage() {
  const { stocktakeId } = useParams()
  const settings = useSettingsStore((s) => s.settings)
  const stocktake = useLiveQuery(
    () => (stocktakeId ? db.stocktakes.get(stocktakeId) : undefined),
    [stocktakeId],
  )
  const pending =
    useLiveQuery(
      () =>
        stocktakeId
          ? db.outbox
              .where('stocktakeId')
              .equals(stocktakeId)
              .filter((e) => e.status === 'pending' || e.status === 'syncing')
              .count()
          : 0,
      [stocktakeId],
    ) ?? 0
  const rejected =
    useLiveQuery(
      () =>
        stocktakeId
          ? db.outbox
              .where('stocktakeId')
              .equals(stocktakeId)
              .filter((e) => e.status === 'rejected' || e.status === 'conflict')
              .count()
          : 0,
      [stocktakeId],
    ) ?? 0
  const [online, setOnline] = useState(false)

  useEffect(() => {
    if (settings?.apiMode === 'mock') {
      setOnline(true)
      return
    }
    void probeServer(settings?.apiBaseUrl ?? '').then((r) => setOnline(r.state === 'online'))
  }, [settings])

  async function submitLocal() {
    if (!stocktake || !stocktakeId) return
    if (!online && settings?.apiMode === 'live') {
      toast.error('Offline — cannot claim server submission. Counts remain local/pending.')
      return
    }
    const snap = await getSyncSnapshot()
    const now = new Date().toISOString()
    await db.stocktakes.update(stocktakeId, {
      status: 'submitted',
      submittedAt: now,
      serverState: pending > 0 || settings?.apiMode === 'mock' ? 'local-only' : 'mock-accepted',
      audit: [
        ...stocktake.audit,
        {
          id: createId(),
          at: now,
          actor: useAuthStore.getState().session?.name ?? 'counter',
          action: 'submitted',
          detail:
            pending > 0
              ? `Local submit with ${pending} pending sync events. NOT server-approved.`
              : `Local submit. Server POST /submit not confirmed. Pull unavailable. pendingDevices=${snap.pending}`,
          source: 'local',
        },
      ],
    })
    toast.success('Session marked submitted locally — not server approval')
  }

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost">
        <Link to={`/count/${stocktakeId}`}>← Scanner</Link>
      </Button>
      <h1 className="text-xl font-bold">Submit session</h1>
      <p className="text-sm text-muted">{stocktake?.name}</p>

      <div className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
        <div className="flex justify-between">
          <span>Pending sync</span>
          <Badge variant={pending ? 'warning' : 'success'}>{pending}</Badge>
        </div>
        <div className="flex justify-between">
          <span>Rejected / conflicts</span>
          <Badge variant={rejected ? 'danger' : 'muted'}>{rejected}</Badge>
        </div>
        <div className="flex justify-between">
          <span>Connectivity</span>
          <Badge variant={online ? 'success' : 'warning'}>
            {settings?.apiMode === 'mock' ? 'mock' : online ? 'online' : 'offline'}
          </Badge>
        </div>
      </div>

      {pending > 0 && (
        <p className="text-sm text-warning">
          {pending} events still pending. Submit will not pretend the server accepted them.
        </p>
      )}
      {rejected > 0 && (
        <p className="text-sm text-danger">
          Resolve conflicts/rejections in Sync monitor or ask a manager before relying on server
          totals.
        </p>
      )}

      <Button className="w-full" variant="secondary" onClick={() => void processOutbox({ force: true })}>
        Sync now
      </Button>
      <Button className="w-full" onClick={() => void submitLocal()}>
        Submit locally
      </Button>
      <p className="text-xs text-muted">
        Offline submit cannot falsely claim server approval. Server remains authoritative once
        wired.
      </p>
    </div>
  )
}
