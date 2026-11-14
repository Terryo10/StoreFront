import { Link } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { db } from '@/db/schema'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/EmptyState'
import { OfflineBanner } from '@/components/OfflineBanner'
import { useSettingsStore } from '@/features/settings/settings-store'
import { useEffect, useState } from 'react'
import { probeServer, type ConnectivityState } from '@/lib/connectivity'
import { getSyncSnapshot } from '@/services/sync-engine'

export function CountSessionsPage() {
  const settings = useSettingsStore((s) => s.settings)
  const sessions =
    useLiveQuery(
      () =>
        db.stocktakes
          .filter((s) => s.status === 'draft' || s.status === 'counting')
          .toArray(),
      [],
    ) ?? []
  const [conn, setConn] = useState<ConnectivityState>('checking')
  const [pullAvailable, setPullAvailable] = useState(false)

  useEffect(() => {
    void getSyncSnapshot().then((s) => setPullAvailable(s.pullAvailable))
    if (settings?.apiMode === 'mock') {
      setConn('online')
      return
    }
    void probeServer(settings?.apiBaseUrl ?? '').then((r) => setConn(r.state))
  }, [settings?.apiBaseUrl, settings?.apiMode])

  return (
    <div className="space-y-3 p-4">
      <OfflineBanner state={conn} pullAvailable={pullAvailable} />
      <h1 className="text-xl font-bold">Assigned / open stocktakes</h1>
      <p className="text-sm text-muted">
        Device enrollment is not on the server — showing open sessions available locally.
      </p>
      <div className="space-y-2">
        {sessions.map((s) => (
          <Link
            key={s.id}
            to={`/count/${s.id}`}
            className="flex min-h-14 items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
          >
            <div>
              <p className="font-semibold">{s.name}</p>
              <p className="text-xs text-muted">
                {s.locationName} · {s.blind ? 'blind' : 'open'}
              </p>
            </div>
            <Badge variant={s.status === 'counting' ? 'info' : 'muted'}>{s.status}</Badge>
          </Link>
        ))}
      </div>
      {sessions.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title="No open sessions"
          description="Ask a supervisor to create and start a stocktake."
        />
      )}
    </div>
  )
}
