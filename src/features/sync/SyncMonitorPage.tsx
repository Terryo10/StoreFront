import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SyncStatusBadge } from '@/components/SyncStatusBadge'
import { db } from '@/db/schema'
import { useLiveQuery } from '@/lib/useLiveQuery'
import {
  attemptPull,
  exportDiagnostics,
  getSyncSnapshot,
  processOutbox,
  subscribeSync,
} from '@/services/sync-engine'
import { formatDateTime, downloadTextFile } from '@/lib/utils'
import { setMockFault, getMockFault, type MockFault } from '@/api/mock'
import { useSettingsStore } from '@/features/settings/settings-store'

export function SyncMonitorPage() {
  const settings = useSettingsStore((s) => s.settings)
  const outbox = useLiveQuery(() => db.outbox.orderBy('deviceSequence').reverse().toArray(), []) ?? []
  const conflicts =
    useLiveQuery(() => db.conflicts.orderBy('createdAt').reverse().toArray(), []) ?? []
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof getSyncSnapshot>> | null>(null)
  const [fault, setFault] = useState<MockFault>(getMockFault())

  async function refresh() {
    setSnapshot(await getSyncSnapshot())
  }

  useEffect(() => {
    void refresh()
    const unsub = subscribeSync(() => {
      void refresh()
    })
    return () => {
      unsub()
    }
  }, [])

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sync monitor</h1>
          <p className="text-sm text-muted">
            Foreground/manual sync is mandatory. Background Sync is not assumed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={async () => {
              const r = await processOutbox({ force: true })
              toast.message(`Push: ack ${r.acknowledged}, reject ${r.rejected}, conflict ${r.conflicts}`)
              await refresh()
            }}
          >
            Push now
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const r = await attemptPull()
              toast.message(r.message)
              await refresh()
            }}
          >
            Pull now
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              const json = await exportDiagnostics()
              downloadTextFile(`stocktake-diagnostics-${Date.now()}.json`, json, 'application/json')
              toast.success('Diagnostics exported')
            }}
          >
            Export diagnostics
          </Button>
        </div>
      </div>

      {!snapshot?.pullAvailable && (
        <div className="rounded-md bg-info/10 px-3 py-2 text-sm text-info">
          Server pull not available. Do not treat the local catalogue as current server state.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Pending" value={snapshot?.pending ?? 0} />
        <Metric label="Acknowledged" value={snapshot?.acknowledged ?? 0} />
        <Metric label="Rejected" value={snapshot?.rejected ?? 0} />
        <Metric label="Conflicts" value={snapshot?.conflicts ?? 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Device</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>Device ID: <span className="font-mono text-xs">{snapshot?.deviceId}</span></p>
          <p>Sequence: {snapshot?.deviceSequence}</p>
          <p>Last successful push: {formatDateTime(snapshot?.lastSuccessfulPushAt ?? null)}</p>
          <p>Last pull attempt: {formatDateTime(snapshot?.lastPullAttemptAt ?? null)}</p>
          <p className="text-muted">{snapshot?.lastPullDetail}</p>
          <p>Pending devices (enrollment): <Badge variant="muted">not available</Badge></p>
        </CardContent>
      </Card>

      {settings?.apiMode === 'mock' && (
        <Card>
          <CardHeader>
            <CardTitle>Mock fault injection</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(['none', 'network', 'conflict', 'reject', 'auth'] as MockFault[]).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={fault === f ? 'default' : 'secondary'}
                onClick={() => {
                  setMockFault(f)
                  setFault(f)
                }}
              >
                {f}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Outbox</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {outbox.slice(0, 50).map((ev) => (
            <div
              key={ev.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm"
            >
              <div>
                <p className="font-mono text-xs">{ev.id.slice(0, 8)}… seq {ev.deviceSequence}</p>
                <p>
                  qty {ev.quantity} · attempts {ev.attemptCount}
                </p>
                {ev.lastError && <p className="text-xs text-danger">{ev.lastError}</p>}
              </div>
              <SyncStatusBadge
                status={
                  ev.status === 'acknowledged'
                    ? 'synced'
                    : ev.status === 'syncing'
                      ? 'syncing'
                      : ev.status === 'conflict'
                        ? 'conflict'
                        : ev.status === 'rejected'
                          ? 'rejected'
                          : 'pending'
                }
              />
            </div>
          ))}
          {outbox.length === 0 && <p className="text-sm text-muted">Outbox empty.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conflicts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {conflicts.map((c) => (
            <div key={c.id} className="rounded border border-border p-3">
              <p className="font-medium">{c.code}</p>
              <p>{c.message}</p>
              <p className="text-xs text-muted">
                Ask a manager to review. Event preserved — never dropped.
              </p>
            </div>
          ))}
          {conflicts.length === 0 && <p className="text-muted">No conflicts.</p>}
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs uppercase text-muted">{label}</p>
        <p className="text-3xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}
