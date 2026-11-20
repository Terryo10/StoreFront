import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { CloudOff, LogOut, RefreshCw, Server, Wifi } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/features/auth/auth-store'
import { useConnectivity } from '@/features/sync/connectivity-store'
import { useSettings } from '@/features/settings/settings-store'
import { can, ROLE_LABELS } from '@/lib/permissions'
import { cn, formatTime, timeAgo } from '@/lib/utils'
import { useHotkeys } from './hotkeys'
import { useOpenShift, useSyncSnapshot } from './hooks'
import { ShortcutSheet } from './ShortcutSheet'
import { GlobalNotices } from './GlobalNotices'
import { ConfirmDialog } from '@/components/ui/dialog'

export function TillLayout() {
  const session = useAuth((s) => s.session)!
  const signOut = useAuth((s) => s.signOut)
  const settings = useSettings((s) => s.settings)!
  const shift = useOpenShift()
  const snapshot = useSyncSnapshot()
  const reachability = useConnectivity((s) => s.reachability)
  const latency = useConnectivity((s) => s.latencyMs)
  const syncing = useConnectivity((s) => s.syncing)
  const navigate = useNavigate()
  const [helpOpen, setHelpOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  const sells = can(session.role, 'sale.ring')
  const counts = can(session.role, 'count.perform')
  const nav = [
    sells && { to: '/sale', label: 'Sale', key: '1' },
    sells && { to: '/returns', label: 'Returns', key: '2' },
    sells && { to: '/history', label: 'History', key: '3' },
    counts && { to: '/count', label: 'Stock count', key: '4' },
    { to: '/sync', label: 'Sync', key: '5' },
    { to: '/settings', label: 'Settings', key: '6' },
  ].filter(Boolean) as Array<{ to: string; label: string; key: string }>

  useHotkeys(
    {
      F1: () => setHelpOpen(true),
      ...Object.fromEntries(nav.map((n) => [`Alt+${n.key}`, () => navigate(n.to)])),
    },
    { inInput: true },
  )

  const queued = snapshot ? snapshot.pending : 0
  const problems = snapshot ? snapshot.rejected + snapshot.conflicts : 0

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-stretch border-b border-rule bg-surface">
        <div className="flex items-center gap-2 border-r border-rule px-4">
          <span className="grid size-7 place-items-center rounded bg-teal text-[13px] font-bold text-on-teal">{settings.tillCode.slice(0, 2)}</span>
          <div className="leading-tight">
            <p className="text-[13px] font-semibold">{settings.storeName}</p>
            <p className="text-xs text-ink-soft">Till {settings.tillCode}</p>
          </div>
        </div>

        <nav aria-label="Main" className="flex items-stretch">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              title={`Alt+${n.key}`}
              className={({ isActive }) =>
                cn(
                  'flex items-center border-b-[3px] px-3.5 text-[14px] font-medium',
                  isActive ? 'border-teal text-teal' : 'border-transparent text-ink-soft hover:text-ink',
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 px-3">
          {settings.apiMode === 'mock' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-st-pending px-2.5 py-1 text-[13px] font-medium text-st-pending" title="All server responses are simulated on this device">
              <Server className="size-3.5" /> Mock server
            </span>
          )}

          {shift ? (
            <span className="hidden text-[13px] text-ink-soft xl:inline" title={`Opened ${formatTime(shift.openedAt)} by ${shift.cashierName}`}>
              Shift {shift.number}, since {formatTime(shift.openedAt)}
            </span>
          ) : shift === null && sells ? (
            <span className="text-[13px] font-medium text-st-pending">No shift open</span>
          ) : null}

          <NavLink
            to="/sync"
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium',
              problems > 0 ? 'bg-st-rejected-bg text-st-rejected' : queued > 0 ? 'bg-st-pending-bg text-st-pending' : 'bg-st-synced-bg text-st-synced',
            )}
            title={snapshot?.lastSuccessfulPushAt ? `Last successful push ${timeAgo(snapshot.lastSuccessfulPushAt)}` : 'Nothing pushed yet'}
          >
            <RefreshCw className={cn('size-3.5', syncing && 'animate-spin')} aria-hidden />
            {problems > 0 ? `${problems} need attention` : queued > 0 ? `${queued} to sync` : 'All synced'}
          </NavLink>

          <span
            role="status"
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium',
              reachability === 'online' ? 'text-st-synced' : reachability === 'offline' ? 'bg-st-rejected-bg text-st-rejected' : 'text-ink-soft',
            )}
          >
            {reachability === 'offline' ? <CloudOff className="size-3.5" /> : <Wifi className="size-3.5" />}
            {reachability === 'online' ? `Server online${latency != null ? `, ${latency} ms` : ''}` : reachability === 'offline' ? 'Server offline' : 'Checking'}
          </span>

          <div className="ml-1 flex items-center gap-2 border-l border-rule pl-3">
            <div className="text-right leading-tight">
              <p className="text-[13px] font-semibold">{session.name}</p>
              <p className="text-xs text-ink-soft">{ROLE_LABELS[session.role]}</p>
            </div>
            <button type="button" aria-label="Sign out" className="grid size-10 place-items-center rounded-md text-ink-soft hover:bg-sunk" onClick={() => setConfirmSignOut(true)}>
              <LogOut className="size-4.5" />
            </button>
          </div>
        </div>
      </header>

      <GlobalNotices />

      <main className="min-h-0 flex-1">
        <Outlet />
      </main>

      <ShortcutSheet open={helpOpen} onOpenChange={setHelpOpen} />
      <ConfirmDialog
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title="Sign out of this till?"
        body={
          <p>
            Your shift stays open and every saved sale stays on this till. {queued > 0 && `${queued} event(s) still waiting to sync will be sent after the next sign-in.`}
          </p>
        }
        confirmLabel="Sign out"
        onConfirm={async () => {
          setConfirmSignOut(false)
          await signOut()
          toast.success('Signed out')
          navigate('/login')
        }}
      />
    </div>
  )
}
