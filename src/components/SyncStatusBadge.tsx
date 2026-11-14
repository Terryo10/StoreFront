import type { SyncVisualStatus } from '@/domain/types'
import { Badge } from '@/components/ui/badge'

const MAP: Record<
  SyncVisualStatus | 'local' | 'syncing',
  { label: string; variant: 'muted' | 'warning' | 'success' | 'danger' | 'info' | 'default' }
> = {
  local: { label: 'Saved locally', variant: 'info' },
  pending: { label: 'Pending sync', variant: 'warning' },
  syncing: { label: 'Syncing', variant: 'default' },
  synced: { label: 'Synced', variant: 'success' },
  conflict: { label: 'Conflict', variant: 'danger' },
  rejected: { label: 'Rejected', variant: 'danger' },
}

export function SyncStatusBadge({
  status,
}: {
  status: SyncVisualStatus | 'local' | 'syncing'
}) {
  const cfg = MAP[status]
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>
}
