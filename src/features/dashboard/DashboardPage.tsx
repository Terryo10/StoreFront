import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { db } from '@/db/schema'
import { getSyncSnapshot } from '@/services/sync-engine'
import { probeServer, type ConnectivityState } from '@/lib/connectivity'
import { useSettingsStore } from '@/features/settings/settings-store'
import { OfflineBanner } from '@/components/OfflineBanner'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/utils'

export function DashboardPage() {
  const settings = useSettingsStore((s) => s.settings)
  const stocktakes = useLiveQuery(() => db.stocktakes.toArray(), []) ?? []
  const conflicts = useLiveQuery(() => db.conflicts.filter((c) => !c.resolvedAt).count(), []) ?? 0
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof getSyncSnapshot>> | null>(null)
  const [conn, setConn] = useState<{ state: ConnectivityState; detail: string }>({
    state: 'checking',
    detail: '',
  })

  useEffect(() => {
    void getSyncSnapshot().then(setSnapshot)
    const base = settings?.apiBaseUrl ?? ''
    if (settings?.apiMode === 'mock') {
      setConn({ state: 'online', detail: 'mock mode' })
      return
    }
    void probeServer(base).then((r) => setConn({ state: r.state, detail: r.detail }))
  }, [settings?.apiBaseUrl, settings?.apiMode])

  const open = stocktakes.filter((s) => s.status === 'draft' || s.status === 'counting')
  const submitted = stocktakes.filter((s) => s.status === 'submitted')

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted">Session progress, sync health, unresolved work</p>
        </div>
        <Button asChild>
          <Link to="/count">Start counting</Link>
        </Button>
      </div>

      <OfflineBanner
        state={conn.state}
        detail={conn.detail}
        pullAvailable={snapshot?.pullAvailable ?? false}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat title="Open sessions" value={String(open.length)} hint="Draft + counting" />
        <Stat title="Awaiting review" value={String(submitted.length)} hint="Submitted" />
        <Stat title="Pending sync" value={String(snapshot?.pending ?? '—')} hint="Outbox events" />
        <Stat
          title="Conflicts / rejects"
          value={`${snapshot?.conflicts ?? 0} / ${snapshot?.rejected ?? 0}`}
          hint={`${conflicts} open conflict records`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Open stocktakes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {open.length === 0 && (
              <p className="text-sm text-muted">No open sessions. Create one from Stocktakes.</p>
            )}
            {open.map((s) => (
              <Link
                key={s.id}
                to={`/stocktakes/${s.id}`}
                className="flex min-h-11 items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-background"
              >
                <span className="font-medium">{s.name}</span>
                <Badge variant="muted">{s.status}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sync health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Device" value={snapshot?.deviceId?.slice(0, 8) ?? '—'} />
            <Row label="Sequence" value={String(snapshot?.deviceSequence ?? 0)} />
            <Row label="Last push" value={formatDateTime(snapshot?.lastSuccessfulPushAt)} />
            <Row label="Last pull attempt" value={formatDateTime(snapshot?.lastPullAttemptAt)} />
            <p className="text-muted">{snapshot?.lastPullDetail}</p>
            <p className="text-xs text-muted">
              Pending devices / enrollment: <strong>not available on server</strong> — UI placeholder
              only.
            </p>
            <Button asChild variant="secondary" className="mt-2">
              <Link to="/sync">Open sync monitor</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Stat({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs uppercase tracking-wide text-muted">{title}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-muted">{hint}</p>
      </CardContent>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
