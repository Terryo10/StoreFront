import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/misc'
import { useOpenShift } from '@/app/hooks'
import { db } from '@/db/schema'
import { useLive } from '@/lib/use-live'
import { formatMoney } from '@/lib/currency'
import { errorMessage, formatDateTime } from '@/lib/utils'
import { firstError, openShiftSchema } from '@/lib/validation'
import { actorOf, useAuth } from '@/features/auth/auth-store'
import { useSettings } from '@/features/settings/settings-store'
import { useCart } from '@/features/sale/cart-store'
import { openShift } from './shift-service'

export function OpenShiftPage() {
  const session = useAuth((s) => s.session)!
  const settings = useSettings((s) => s.settings)!
  const shift = useOpenShift()
  const lastClosed = useLive(() => db.shifts.where('status').equals('closed').reverse().sortBy('openedAt').then((r) => r[0] ?? null), [], null)
  const navigate = useNavigate()
  const firstRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({ floatUSD: '50.00', floatZWG: '0.00', rate: settings.defaultExchangeRate })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    firstRef.current?.select()
  }, [])

  if (shift) return <Navigate to="/sale" replace />

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = openShiftSchema.safeParse(form)
    setErrors(firstError(parsed))
    if (!parsed.success) return
    setBusy(true)
    setFormError(null)
    try {
      const opened = await openShift({
        cashier: actorOf(session),
        float: { USD: parsed.data.floatUSD, ZWG: parsed.data.floatZWG },
        exchangeRate: parsed.data.rate,
        tillCode: settings.tillCode,
      })
      useCart.setState({ shiftId: opened.id })
      toast.success(`Shift ${opened.number} opened`)
      navigate('/sale', { replace: true })
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto p-6">
      <form onSubmit={submit} noValidate className="w-full max-w-xl space-y-5 rounded-lg border border-rule bg-surface p-7">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Open a shift</h1>
          <p className="mt-1 text-ink-soft">Count the float in the drawer and set today's ZiG rate. Every sale in this shift uses that rate.</p>
        </div>
        {formError && <Notice tone="danger" title={formError} />}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Float in US$" htmlFor="floatUSD" error={errors.floatUSD}>
            <Input ref={firstRef} id="floatUSD" inputMode="decimal" className="tnum text-lg" value={form.floatUSD} onChange={set('floatUSD')} invalid={!!errors.floatUSD} />
          </Field>
          <Field label="Float in ZiG" htmlFor="floatZWG" error={errors.floatZWG}>
            <Input id="floatZWG" inputMode="decimal" className="tnum text-lg" value={form.floatZWG} onChange={set('floatZWG')} invalid={!!errors.floatZWG} />
          </Field>
        </div>

        <Field label="ZiG per 1 US$" htmlFor="rate" error={errors.rate} hint="Set manually for this shift. It cannot change until the shift is closed.">
          <Input id="rate" inputMode="decimal" className="tnum text-lg" value={form.rate} onChange={set('rate')} invalid={!!errors.rate} />
        </Field>

        <div className="flex items-center justify-between gap-4 border-t border-rule pt-5">
          <p className="text-sm text-ink-soft">
            Cashier <strong className="text-ink">{session.name}</strong>
            {lastClosed && (
              <>
                <br />
                Last shift closed {formatDateTime(lastClosed.closedAt)}, counted {formatMoney(lastClosed.countedCash?.USD ?? '0', 'USD')}
              </>
            )}
          </p>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Opening…' : 'Open shift'}
          </Button>
        </div>
      </form>
    </div>
  )
}
