import { CheckCheck, CircleAlert, CloudUpload, GitMerge, HardDrive } from 'lucide-react'
import type { SyncState } from '@/db/types'
import { cn } from '@/lib/utils'

const CHIP: Record<SyncState, { label: string; icon: typeof HardDrive; className: string; explain: string }> = {
  local: { label: 'Saved locally', icon: HardDrive, className: 'bg-st-local-bg text-st-local', explain: 'Stored on this till; not sent to the server yet' },
  pending: { label: 'Pending sync', icon: CloudUpload, className: 'bg-st-pending-bg text-st-pending', explain: 'Sent or waiting to send; the server has not confirmed it' },
  synced: { label: 'Synced', icon: CheckCheck, className: 'bg-st-synced-bg text-st-synced', explain: 'The server confirmed it received this' },
  rejected: { label: 'Rejected', icon: CircleAlert, className: 'bg-st-rejected-bg text-st-rejected', explain: 'The server refused it; it is kept here for review' },
  conflict: { label: 'Conflict', icon: GitMerge, className: 'bg-st-conflict-bg text-st-conflict', explain: 'The server reported a conflict; it needs a decision' },
}

export function StatusChip({ state, className, size = 'md' }: { state: SyncState; className?: string; size?: 'sm' | 'md' }) {
  const c = CHIP[state]
  const Icon = c.icon
  return (
    <span
      title={c.explain}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium',
        size === 'md' ? 'px-2.5 py-1 text-[13px]' : 'px-2 py-0.5 text-xs',
        c.className,
        className,
      )}
    >
      <Icon className={size === 'md' ? 'size-3.5' : 'size-3'} aria-hidden />
      {c.label}
    </span>
  )
}
