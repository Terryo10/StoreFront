import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/misc'
import { StatusChip } from '@/components/ui/status-chip'
import { useOpenShift } from '@/app/hooks'
import type { Shift } from '@/db/types'
import { db } from '@/db/schema'
import { CURRENCIES, formatMoney, type CurrencyCode } from '@/lib/currency'
import { dec } from '@/lib/decimal'
import { useLive } from '@/lib/use-live'
import { cn, errorMessage, formatDateTime } from '@/lib/utils'
import { cashCountSchema, firstError } from '@/lib/validation'
import { actorOf, useAuth } from '@/features/auth/auth-store'
import { useCart } from '@/features/sale/cart-store'
import { EMPTY_CART } from '@/features/sale/sale-service'
import { cashVariance, closeShift } from './shift-service'

export function CloseShiftPage() {
  const session = useAuth((s) => s.session)!
  const openShift = useOpenShift()
  const [closed, setClosed] = useState<Shift | null>(null)

  // The result screen must survive the open shift disappearing, so this route is not shift-guarded.
  if (closed) return <ShiftResult shift={closed} />
  if (openShift === undefined) return null
  if (openShift === null) return <Navigate to="/shift/open" replace />
  return <BlindCount shift={openShift} actor={actorOf(session)} onClosed={setClosed} />
}

function BlindCount({ shift, actor, onClosed }: { shift: Shift; actor: { id: string; name: string }; onClosed: (s: Shift) => void }) {
  const firstRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({ USD: '', ZWG: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const held = useLive(() => db.heldSales.where('shiftId').equals(shift.id).count(), [shift.id], 0)
  const navigate = useNavigate()

  useEffect(() => firstRef.current?.focus(), [])

  function review(e: React.FormEvent) {
    e.preventDefault()
    const parsed = cashCountSchema.safeParse(form)
    setErrors(firstError(parsed))
    if (parsed.success) setConfirm(true)
  }

  async function commit() {
    setBusy(true)
    setFormError(null)
    try {
      const result = await closeShift({ shiftId: shift.id, counted: form, actor })
      useCart.setState({ cart: EMPTY_CART, shiftId: null, selectedId: null })
      setConfirm(false)
      toast.success(`Shift ${result.number} closed`)
      onClosed(result)
    } catch (err) {
      setConfirm(false)
      setFormError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto p-6">
      <form onSubmit={review} noValidate className="w-full max-w-xl space-y-5 rounded-lg border border-rule bg-surface p-7">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Close shift {shift.number}</h1>
          <p className="mt-1 text-ink-soft">Count all cash in the drawer, including the float. The expected amount is shown only after you confirm your count.</p>
        </div>
        {held > 0 && (
          <Notice tone="warn" title={`${held} held sale(s) on this shift`} action={<Button size="sm" variant="secondary" onClick={() => navigate('/sale')}>Go to sale</Button>}>
            Resume and finish or clear them before closing.
          </Notice>
        )}
        {formError && <Notice tone="danger" title={formError} />}

        <div className="grid grid-cols-2 gap-4">
          {(['USD', 'ZWG'] as CurrencyCode[]).map((c, i) => (
            <Field key={c} label={`${CURRENCIES[c].symbol} counted`} htmlFor={`count-${c}`} error={errors[c]}>
              <Input
                ref={i === 0 ? firstRef : undefined}
                id={`count-${c}`}
                inputMode="decimal"
                className="tnum h-14 text-2xl"
                value={form[c as 'USD' | 'ZWG']}
                onChange={(e) => setForm((f) => ({ ...f, [c]: e.target.value }))}
                invalid={!!errors[c]}
              />
            </Field>
          ))}
        </div>

        <p className="flex items-center gap-2 rounded-md bg-sunk px-3 py-2 text-sm text-ink-soft">
          <EyeOff className="size-4" /> Blind close: expected cash stays hidden until your count is saved.
        </p>

        <div className="flex justify-end gap-2 border-t border-rule pt-5">
          <Button variant="secondary" onClick={() => navigate('/sale')}>
            Back to sale
          </Button>
          <Button type="submit" size="lg">
            Review count
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Confirm your cash count"
        busy={busy}
        confirmLabel={busy ? 'Closing…' : 'Confirm and close shift'}
        onConfirm={() => void commit()}
        body={
          <div className="space-y-3">
            <dl className="tnum grid grid-cols-2 gap-2 text-lg">
              <dt className="text-ink-soft">US$</dt>
              <dd className="text-right font-semibold">{formatMoney(form.USD || '0', 'USD')}</dd>
              <dt className="text-ink-soft">ZiG</dt>
              <dd className="text-right font-semibold">{formatMoney(form.ZWG || '0', 'ZWG')}</dd>
            </dl>
            <p className="text-sm text-ink-soft">You cannot change the count after confirming. The shift closes and no more sales can be made on it.</p>
          </div>
        }
      />
    </div>
  )
}

function ShiftResult({ shift }: { shift: Shift }) {
  const navigate = useNavigate()
  const signOut = useAuth((s) => s.signOut)
  const variance = cashVariance(shift.expectedCash ?? {}, shift.countedCash ?? {})
  const live = useLive(() => db.shifts.get(shift.id), [shift.id])
  const sales = useLive(() => db.sales.where('shiftId').equals(shift.id).toArray(), [shift.id], [])

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl space-y-5 rounded-lg border border-rule bg-surface p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Shift {shift.number} closed</h1>
            <p className="mt-1 text-ink-soft">
              {formatDateTime(shift.openedAt)} to {formatDateTime(shift.closedAt)}, {sales.filter((s) => s.kind === 'sale').length} sales and {sales.filter((s) => s.kind === 'refund').length} refunds
            </p>
          </div>
          <StatusChip state={live?.syncState ?? shift.syncState} />
        </div>

        <table className="tnum w-full text-left">
          <thead>
            <tr className="border-b border-rule text-sm text-ink-soft">
              <th className="py-2 font-medium">Currency</th>
              <th className="py-2 text-right font-medium">Counted</th>
              <th className="py-2 text-right font-medium">Expected</th>
              <th className="py-2 text-right font-medium">Over or short</th>
            </tr>
          </thead>
          <tbody>
            {(['USD', 'ZWG'] as CurrencyCode[]).map((c) => {
              const v = dec(variance[c] ?? '0')
              return (
                <tr key={c} className="border-b border-rule text-lg">
                  <td className="py-3">{CURRENCIES[c].label}</td>
                  <td className="py-3 text-right">{formatMoney(shift.countedCash?.[c], c)}</td>
                  <td className="py-3 text-right">{formatMoney(shift.expectedCash?.[c], c)}</td>
                  <td className={cn('py-3 text-right font-semibold', v.isZero() ? 'text-st-synced' : v.isNegative() ? 'text-st-rejected' : 'text-st-pending')}>
                    {v.isZero() ? 'Balanced' : `${v.isNegative() ? 'Short' : 'Over'} ${formatMoney(v.abs().toFixed(2), c)}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <p className="text-sm text-ink-soft">The close is saved on this till and queued for the server. A supervisor reviews variances in the back office.</p>

        <div className="flex justify-end gap-2 border-t border-rule pt-5">
          <Button
            variant="secondary"
            onClick={async () => {
              await signOut()
              navigate('/login')
            }}
          >
            Sign out
          </Button>
          <Button onClick={() => navigate('/shift/open')}>Open a new shift</Button>
        </div>
      </div>
    </div>
  )
}
