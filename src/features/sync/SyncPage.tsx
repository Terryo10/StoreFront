import { useState } from 'react'
import { Download, FlaskConical, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { useSyncMeta, useSyncSnapshot } from '@/app/hooks'
import { integrationStatus } from '@/api'
import { getMockFault, MOCK_FAULT_LABELS, MOCK_FAULTS, mockDeliveredCount, setMockFault, subscribeMock, type MockFault } from '@/api/mock'
import { Button } from '@/components/ui/button'
import { EmptyState, Notice, Panel } from '@/components/ui/misc'
import { db } from '@/db/schema'
import type { OutboxEvent } from '@/db/types'
import { useLive } from '@/lib/use-live'
import { cn, downloadTextFile, formatDateTime, timeAgo } from '@/lib/utils'
import { buildDiagnostics } from '@/services/diagnostics'
import { clearAuthBlock, keepConflictForReview, requeueEvent } from '@/services/sync-engine'
import { useSettings } from '@/features/settings/settings-store'
import { useConnectivity } from './connectivity-store'
import { useSyncExternalStore } from 'react'

const EVENT_LABEL: Record<OutboxEvent['type'], string> = {
  'sale.completed': 'Sale',
  'sale.voided': 'Cleared cart',
  'sale.refunded': 'Refund',
  'shift.opened': 'Shift opened',
  'shift.closed': 'Shift closed',
  'stocktake.count.recorded': 'Stock count',
  'stocktake.exception.recorded': 'Unknown barcode',
  'stocktake.submitted': 'Count submitted',
}

function describe(ev: OutboxEvent): string {
  const p = ev.payload as Record<string, unknown>
  if (p.receipt_number) return `Receipt ${p.receipt_number}`
  if (p.shift_number) return `Shift ${p.shift_number}`
  if (p.barcode) return `Barcode ${p.barcode}`
  return `Sequence ${ev.deviceSequence}`
}

export function SyncPage() {
  const snapshot = useSyncSnapshot()
  const meta = useSyncMeta()
  const mode = useSettings((s) => s.settings?.apiMode)
  const { reachability, detail, syncing, lastRun, sync } = useConnectivity()
  const problems = useLive(() => db.outbox.where('status').anyOf('rejected', 'conflict').sortBy('deviceSequence'), [], [])
  const queue = useLive(() => db.outbox.where('status').anyOf('pending', 'syncing').limit(200).sortBy('deviceSequence'), [], [])
  const conflicts = useLive(() => db.conflicts.filter((c) => c.resolvedAt === null).toArray(), [], [])
  const [busy, setBusy] = useState(false)

  async function runSync() {
    setBusy(true)
    const r = await sync(true)
    setBusy(false)
    if (!r) return
    if (r.stoppedReason === 'nothing_due') toast.info('Nothing waiting to sync')
    else if (r.error) toast.error(`Sync stopped: ${r.error}`)
    else toast.success(`Server confirmed ${r.acknowledged} event(s)`)
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sync</h1>
            <p className="text-ink-soft">The till sends its events every 20 seconds while open, and whenever you press Sync now. Nothing is marked synced until the server confirms that exact event.</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                downloadTextFile(`pos-diagnostics-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`, await buildDiagnostics())
              }}
            >
              <Download /> Export diagnostics
            </Button>
            <Button onClick={() => void runSync()} disabled={busy || syncing}>
              <RefreshCw className={cn(syncing && 'animate-spin')} /> {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          </div>
        </div>

        {snapshot?.authBlocked && (
          <Notice
            tone="danger"
            title="Automatic sync is paused because the server refused this till's credentials"
            action={
              <Button size="sm" variant="secondary" onClick={() => void clearAuthBlock().then(runSync)}>
                Retry now
              </Button>
            }
          >
            {snapshot.lastPushError}. Events are kept as pending. Sign out and sign in again, then retry. The till never retries 401 or 403 responses in a loop.
          </Notice>
        )}

        <div className="grid grid-cols-4 gap-3">
          <Stat label="Waiting to send" value={snapshot?.pending ?? 0} tone={snapshot?.pending ? 'pending' : 'ok'} sub={snapshot?.local ? `${snapshot.local} never sent yet` : undefined} />
          <Stat label="Rejected by server" value={snapshot?.rejected ?? 0} tone={snapshot?.rejected ? 'bad' : 'ok'} />
          <Stat label="Conflicts" value={snapshot?.conflicts ?? 0} tone={snapshot?.conflicts ? 'conflict' : 'ok'} />
          <Stat label="Confirmed by server" value={snapshot?.acknowledged ?? 0} tone="ok" />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-4">
          <div className="space-y-4">
            <Panel title="Needs attention" bodyClassName="p-0">
              {problems.length === 0 ? (
                <EmptyState icon={ShieldAlert} title="No rejected or conflicting events">
                  Rejected and conflicting events stay here until someone decides what to do. They are never deleted.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-rule">
                  {problems.map((ev) => {
                    const conflict = conflicts.find((c) => c.outboxEventId === ev.id)
                    return (
                      <li key={ev.id} className="flex items-start justify-between gap-4 px-4 py-3">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {EVENT_LABEL[ev.type]}, {describe(ev)}
                            <span className={cn('ml-2 rounded px-1.5 py-0.5 text-xs font-medium', ev.status === 'conflict' ? 'bg-st-conflict-bg text-st-conflict' : 'bg-st-rejected-bg text-st-rejected')}>{ev.status === 'conflict' ? 'Conflict' : 'Rejected'}</span>
                          </p>
                          <p className="text-sm text-ink-soft">{ev.lastError}</p>
                          <p className="text-xs text-ink-soft">
                            Recorded {formatDateTime(ev.observedAt)}, {ev.attemptCount} attempt(s), event {ev.id.slice(0, 8)}
                            {conflict === undefined && ev.status === 'conflict' && ', kept for back-office review'}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {conflict && (
                            <Button size="sm" variant="quiet" onClick={() => void keepConflictForReview(conflict.id).then(() => toast.success('Kept for back-office review'))}>
                              Keep for review
                            </Button>
                          )}
                          <Button size="sm" variant="secondary" onClick={() => void requeueEvent(ev.id).then(() => toast.success('Queued again with the same event id'))}>
                            <RotateCcw className="size-4" /> Send again
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Panel>

            <Panel title={`Queue (${queue.length}${queue.length === 200 ? '+' : ''})`} bodyClassName="p-0">
              {queue.length === 0 ? (
                <p className="px-4 py-4 text-sm text-ink-soft">Everything on this till has been confirmed by the server.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-rule text-left text-ink-soft">
                      <th className="px-4 py-2 font-medium">Seq</th>
                      <th className="py-2 font-medium">Event</th>
                      <th className="py-2 font-medium">Attempts</th>
                      <th className="px-4 py-2 font-medium">Last error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.slice(0, 60).map((ev) => (
                      <tr key={ev.id} className="border-b border-rule">
                        <td className="tnum px-4 py-1.5">{ev.deviceSequence}</td>
                        <td className="py-1.5">
                          {EVENT_LABEL[ev.type]}, {describe(ev)}
                        </td>
                        <td className="tnum py-1.5">{ev.status === 'syncing' ? 'sending' : ev.attemptCount}</td>
                        <td className="max-w-64 truncate px-4 py-1.5 text-ink-soft" title={ev.lastError ?? ''}>
                          {ev.lastError ?? (ev.attemptCount === 0 ? 'Not sent yet' : '')}
                          {ev.nextAttemptAt && ev.status === 'pending' && `, retry ${timeAgo(ev.nextAttemptAt).replace(' ago', '')}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Status">
              <dl className="space-y-2 text-sm">
                <Row label="Server">{reachability === 'online' ? `Reachable (${detail})` : reachability === 'offline' ? `Unreachable (${detail})` : 'Checking'}</Row>
                <Row label="Last successful push">{snapshot?.lastSuccessfulPushAt ? `${formatDateTime(snapshot.lastSuccessfulPushAt)} (${timeAgo(snapshot.lastSuccessfulPushAt)})` : 'Never'}</Row>
                <Row label="Last attempt">{formatDateTime(snapshot?.lastPushAttemptAt)}</Row>
                {lastRun && <Row label="Last run">{lastRun.stoppedReason === 'nothing_due' ? 'Nothing due' : `${lastRun.acknowledged} confirmed, ${lastRun.rejected} rejected, ${lastRun.conflicts} conflicts${lastRun.error ? `; ${lastRun.error}` : ''}`}</Row>}
                <Row label="Catalogue updated">{meta?.catalogueUpdatedAt ? `${formatDateTime(meta.catalogueUpdatedAt)} (${meta.catalogueSource === 'demo-seed' ? 'demo data' : 'server'})` : 'Never'}</Row>
                <Row label="Sync pull">{meta?.pullAvailable ? 'Available' : (meta?.lastPullDetail ?? 'Not checked yet')}</Row>
                <Row label="Device">
                  <span className="tnum break-all">{meta?.deviceId}</span>
                </Row>
                <Row label="Device sequence">{meta?.deviceSequence}</Row>
              </dl>
            </Panel>

            <Panel title="Integrations">
              <ul className="space-y-1.5 text-sm">
                {integrationStatus().map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3">
                    <span>
                      {i.label}
                      <span className="block text-xs text-ink-soft">{i.endpoint}</span>
                    </span>
                    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-xs font-medium', i.state === 'mocked' ? 'bg-st-pending-bg text-st-pending' : i.state === 'not available' ? 'bg-sunk text-ink-soft' : 'bg-st-local-bg text-st-local')}>{i.state}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            {mode === 'mock' && <MockControls />}
          </div>
        </div>
      </div>
    </div>
  )
}

function MockControls() {
  const fault = useSyncExternalStore(subscribeMock, getMockFault)
  const delivered = useSyncExternalStore(subscribeMock, mockDeliveredCount)
  return (
    <Panel title="Mock server faults">
      <p className="mb-3 flex items-start gap-2 text-sm text-ink-soft">
        <FlaskConical className="mt-0.5 size-4 shrink-0" /> Simulate what the real network does. The mock server deduplicates by event id, like a correct server must.
      </p>
      <div className="space-y-1">
        {MOCK_FAULTS.map((f: MockFault) => (
          <label key={f} className={cn('flex min-h-10 cursor-pointer items-center gap-2 rounded px-2 text-sm', fault === f && 'bg-teal-tint')}>
            <input type="radio" name="mock-fault" checked={fault === f} onChange={() => (setMockFault(f), void useConnectivity.getState().probe())} className="size-4 accent-[var(--teal)]" />
            {MOCK_FAULT_LABELS[f]}
          </label>
        ))}
      </div>
      <p className="tnum mt-3 text-sm text-ink-soft">Distinct events the mock server has stored: {delivered}</p>
    </Panel>
  )
}

function Stat({ label, value, tone, sub }: { label: string; value: number; tone: 'ok' | 'pending' | 'bad' | 'conflict'; sub?: string }) {
  return (
    <div className={cn('rounded-lg border bg-surface px-4 py-3', tone === 'bad' ? 'border-st-rejected/50' : tone === 'conflict' ? 'border-st-conflict/50' : tone === 'pending' ? 'border-st-pending/50' : 'border-rule')}>
      <p className="text-sm text-ink-soft">{label}</p>
      <p className={cn('tnum text-3xl font-semibold', tone === 'bad' && 'text-st-rejected', tone === 'conflict' && 'text-st-conflict', tone === 'pending' && 'text-st-pending')}>{value}</p>
      {sub && <p className="text-xs text-ink-soft">{sub}</p>}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2">
      <dt className="text-ink-soft">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
