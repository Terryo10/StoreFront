import { WifiOff } from 'lucide-react'
import type { ConnectivityState } from '@/lib/connectivity'

export function OfflineBanner({
  state,
  detail,
  pullAvailable,
}: {
  state: ConnectivityState
  detail?: string
  pullAvailable?: boolean
}) {
  if (state === 'online' && pullAvailable) return null

  return (
    <div className="space-y-1">
      {state !== 'online' && (
        <div
          role="status"
          className="flex items-center gap-2 bg-warning/15 px-3 py-2 text-sm text-warning"
        >
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            {state === 'checking'
              ? 'Checking server…'
              : state === 'unreachable'
                ? `Server unreachable (${detail ?? 'error'})`
                : 'Offline — counts save locally; sync when connected.'}
          </span>
        </div>
      )}
      {!pullAvailable && (
        <div
          role="status"
          className="bg-info/10 px-3 py-2 text-sm text-info"
        >
          Server pull not available. Catalogue may be stale — do not treat local product data as
          current server truth.
        </div>
      )}
    </div>
  )
}
