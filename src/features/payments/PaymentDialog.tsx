import { useEffect, useMemo, useRef, useState } from 'react'
import { Banknote, CreditCard, Smartphone, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { Kbd, Notice } from '@/components/ui/misc'
import type { Cart, PaymentMethod, Sale, Shift } from '@/db/types'
import { CURRENCIES, formatAmount, formatMoney, type CurrencyCode } from '@/lib/currency'
import { dec, parseDecimalInput } from '@/lib/decimal'
import { createId } from '@/lib/ids'
import { useOnChange } from '@/lib/use-on-change'
import { cn, errorMessage } from '@/lib/utils'
import { useHotkeys } from '@/app/hotkeys'
import { cartTotals } from '@/features/sale/cart-math'
import { completeSale, shiftRates, type Actor } from '@/features/sale/sale-service'
import { dueIn, METHOD_LABELS, summarisePayments, toTenderLine, validateTender, type TenderLine } from './payment-math'

const METHOD_ICON: Record<PaymentMethod, typeof Banknote> = { cash: Banknote, card: CreditCard, mobile_money: Smartphone }
const QUICK_NOTES: Record<CurrencyCode, string[]> = { USD: ['1', '5', '10', '20', '50', '100'], ZWG: ['20', '50', '100', '200', '500', '1000'] }

export function PaymentDialog({
  open,
  cart,
  shift,
  cashier,
  currencies,
  beforeCommit,
  onClose,
  onCompleted,
}: {
  open: boolean
  cart: Cart
  shift: Shift
  cashier: Actor
  currencies: CurrencyCode[]
  beforeCommit: () => Promise<void>
  onClose: () => void
  onCompleted: (sale: Sale) => void
}) {
  const amountRef = useRef<HTMLInputElement>(null)
  const committing = useRef(false)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [currency, setCurrency] = useState<CurrencyCode>('USD')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [tenders, setTenders] = useState<TenderLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const rates = shiftRates(shift)
  const totals = cartTotals(cart)
  const summary = useMemo(() => summarisePayments(totals.total, tenders, rates), [totals.total, tenders, rates])

  useOnChange(open, (o) => {
    if (o) {
      setMethod('cash')
      setCurrency('USD')
      setAmount('')
      setReference('')
      setTenders([])
      setError(null)
    }
  })
  useEffect(() => {
    if (open) committing.current = false
  }, [open])

  const focusAmount = () => setTimeout(() => amountRef.current?.focus(), 0)

  useHotkeys(
    {
      F2: () => (setMethod('cash'), focusAmount()),
      F3: () => (setMethod('card'), focusAmount()),
      F4: () => (setMethod('mobile_money'), focusAmount()),
      F5: () => {
        const i = currencies.indexOf(currency)
        setCurrency(currencies[(i + 1) % currencies.length])
        focusAmount()
      },
      F8: () => (setAmount(dueIn(summary.remainingBase, currency, rates)), focusAmount()),
    },
    { inDialog: true, inInput: true },
    open,
  )

  async function commit(lines: TenderLine[]) {
    if (committing.current) return
    committing.current = true
    setBusy(true)
    setError(null)
    try {
      await beforeCommit()
      const sale = await completeSale({ cart, tenders: lines, shiftId: shift.id, cashier })
      onCompleted(sale)
    } catch (err) {
      committing.current = false
      setError(`The sale was not saved: ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  function addTender(): TenderLine[] | null {
    const parsed = parseDecimalInput(amount, { maxScale: 2 })
    if (!parsed) {
      setError('Enter the amount received')
      return null
    }
    const draft = { id: createId(), method, currency, amount: parsed, reference: method === 'cash' ? null : reference.trim() }
    const err = validateTender(draft, summary.remainingBase, rates)
    if (err) {
      setError(err)
      return null
    }
    const next = [...tenders, toTenderLine(draft, rates)]
    setTenders(next)
    setAmount('')
    setReference('')
    setError(null)
    return next
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (amount.trim()) {
      const next = addTender()
      if (next && summarisePayments(totals.total, next, rates).settled) void commit(next)
      else focusAmount()
      return
    }
    if (summary.settled) void commit(tenders)
    else setError('Enter the amount received')
  }

  const remainingIn = (c: CurrencyCode) => dueIn(summary.remainingBase, c, rates)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()} title="Take payment" width="lg" initialFocus={amountRef}>
      <form onSubmit={onSubmit} noValidate className="grid gap-6 md:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payment method">
            {(['cash', 'card', 'mobile_money'] as PaymentMethod[]).map((m, i) => {
              const Icon = METHOD_ICON[m]
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  onClick={() => (setMethod(m), focusAmount())}
                  className={cn('flex min-h-14 items-center justify-center gap-2 rounded-md border-2 font-medium', method === m ? 'border-teal bg-teal-tint text-teal' : 'border-rule hover:border-rule-strong')}
                >
                  <Icon className="size-5" /> {METHOD_LABELS[m]}
                  <Kbd className="ml-1">F{i + 2}</Kbd>
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Currency</span>
            {currencies.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={currency === c}
                onClick={() => (setCurrency(c), focusAmount())}
                className={cn('min-h-10 rounded-md border px-3 text-sm font-medium', currency === c ? 'border-teal bg-teal text-on-teal' : 'border-rule-strong')}
              >
                {CURRENCIES[c].symbol}
              </button>
            ))}
            <Kbd>F5</Kbd>
            <span className="ml-auto text-sm text-ink-soft">1 US$ = {shift.exchangeRate} ZiG</span>
          </div>

          <Field label={method === 'cash' ? `Cash received (${CURRENCIES[currency].symbol})` : `Amount (${CURRENCIES[currency].symbol})`} htmlFor="tender-amount" error={error}>
            <div className="flex gap-2">
              <Input ref={amountRef} id="tender-amount" inputMode="decimal" autoComplete="off" className="tnum h-14 flex-1 text-2xl" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!error} placeholder={formatAmount(remainingIn(currency))} />
              <Button variant="secondary" size="lg" onClick={() => (setAmount(remainingIn(currency)), focusAmount())}>
                Exact <Kbd>F8</Kbd>
              </Button>
            </div>
          </Field>

          {method === 'cash' ? (
            <div className="grid grid-cols-6 gap-2">
              {QUICK_NOTES[currency].map((n) => (
                <Button
                  key={n}
                  variant="secondary"
                  className="tnum"
                  onClick={() => {
                    setAmount((a) => (dec(parseDecimalInput(a) ?? '0').plus(n).toFixed()))
                    focusAmount()
                  }}
                >
                  +{n}
                </Button>
              ))}
            </div>
          ) : (
            <Field label={method === 'card' ? 'Card terminal reference' : 'EcoCash or other mobile money reference'} htmlFor="tender-ref" hint="No gateway is connected. Type the reference from the terminal slip or SMS.">
              <Input id="tender-ref" value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
          )}

          {tenders.length > 0 && (
            <ul aria-label="Tenders added" className="divide-y divide-rule rounded-md border border-rule">
              {tenders.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="text-sm">
                    {METHOD_LABELS[t.method]} {t.reference && <span className="text-ink-soft">ref {t.reference}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tnum font-medium">{formatMoney(t.amount, t.currency)}</span>
                    <button type="button" aria-label="Remove tender" disabled={busy} onClick={() => setTenders((ts) => ts.filter((x) => x.id !== t.id))} className="grid size-9 place-items-center rounded text-ink-soft hover:bg-sunk">
                      <X className="size-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="flex flex-col gap-3 rounded-lg bg-sunk p-4">
          <dl className="tnum space-y-2">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Total</dt>
              <dd className="font-semibold">{formatMoney(totals.total, 'USD')}</dd>
            </div>
            <div className="flex justify-between text-sm">
              <dt className="text-ink-soft">In ZiG</dt>
              <dd>{formatMoney(dueIn(totals.total, 'ZWG', rates), 'ZWG')}</dd>
            </div>
            <div className="flex justify-between border-t border-rule pt-2">
              <dt className="text-ink-soft">Paid</dt>
              <dd>{formatMoney(summary.paidBase, 'USD')}</dd>
            </div>
          </dl>

          {dec(summary.overpaidBase).greaterThan(0) ? (
            <div className="rounded-md bg-display p-3 text-display-ink">
              <p className="text-sm text-display-soft">Change to give</p>
              <p className="tnum text-3xl font-semibold" data-testid="change-due">
                {formatMoney(summary.changeDue, summary.changeCurrency)}
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-rule bg-surface p-3">
              <p className="text-sm text-ink-soft">Still owed</p>
              <p className="tnum text-3xl font-semibold">{formatMoney(summary.remainingBase, 'USD')}</p>
              <p className="tnum text-sm text-ink-soft">or {formatMoney(remainingIn('ZWG'), 'ZWG')}</p>
            </div>
          )}

          {summary.error && <Notice tone="danger" title={summary.error} />}

          <Button type="submit" size="lg" className="mt-auto w-full" disabled={busy || (!summary.settled && !amount.trim())}>
            {busy ? 'Saving sale…' : summary.settled ? 'Complete sale' : 'Add tender'} <Kbd className="border-white/30 bg-white/15 text-on-teal">Enter</Kbd>
          </Button>
        </aside>
      </form>
    </Dialog>
  )
}
