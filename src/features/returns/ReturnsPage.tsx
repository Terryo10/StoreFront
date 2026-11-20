import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, ReceiptText, Search, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { useOpenShift } from '@/app/hooks'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { EmptyState, Notice } from '@/components/ui/misc'
import { StatusChip } from '@/components/ui/status-chip'
import type { PaymentMethod, Sale } from '@/db/types'
import { CURRENCIES, formatAmount, formatMoney, type CurrencyCode } from '@/lib/currency'
import { dec, roundToStep, sum } from '@/lib/decimal'
import { cn, errorMessage, formatDateTime } from '@/lib/utils'
import { useApproval } from '@/features/auth/ApprovalDialog'
import { actorOf, useAuth } from '@/features/auth/auth-store'
import { ReceiptDialog } from '@/features/payments/ReceiptDialog'
import { METHOD_LABELS } from '@/features/payments/payment-math'
import { useSettings } from '@/features/settings/settings-store'
import { completeRefund, findSalesByBarcode, findSalesByReceipt, loadRefundable, REFUND_REASONS, refundLineAmount, type RefundableSale } from './refund-service'

export function ReturnsPage() {
  const session = useAuth((s) => s.session)!
  const settings = useSettings((s) => s.settings)!
  const shift = useOpenShift()
  const actor = actorOf(session)
  const approval = useApproval()
  const searchRef = useRef<HTMLInputElement>(null)

  const [term, setTerm] = useState('')
  const [matches, setMatches] = useState<Sale[] | null>(null)
  const [original, setOriginal] = useState<RefundableSale | null>(null)
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [reason, setReason] = useState<string>('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [currency, setCurrency] = useState<CurrencyCode>('USD')
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [completedId, setCompletedId] = useState<string | null>(null)

  useEffect(() => searchRef.current?.focus(), [])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    const t = term.trim()
    if (!t) return
    const byReceipt = await findSalesByReceipt(t)
    const found = byReceipt.length ? byReceipt : await findSalesByBarcode(t)
    setMatches(found)
    if (found.length === 1) void choose(found[0].id)
  }

  async function choose(saleId: string) {
    const r = await loadRefundable(saleId)
    setOriginal(r)
    setQtys({})
    setReason('')
    setError(null)
    if (r?.sale.receiptCurrency === 'ZiG') setCurrency('ZWG')
    else if (r?.sale.receiptCurrency === 'USD') setCurrency('USD')
  }

  function reset() {
    setOriginal(null)
    setMatches(null)
    setTerm('')
    setQtys({})
    setReason('')
    setReference('')
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  const refundTotal = useMemo(() => {
    if (!original) return '0.00'
    return sum(original.lines.filter((l) => dec(qtys[l.id] ?? '0').greaterThan(0)).map((l) => refundLineAmount(l, qtys[l.id])))
  }, [original, qtys])

  async function submit() {
    if (!original || !shift) return
    setError(null)
    if (dec(refundTotal).lessThanOrEqualTo(0)) return setError('Choose at least one item and quantity to refund')
    if (!reason) return setError('Choose a reason for the refund')
    if (method !== 'cash' && reference.trim().length < 3) return setError('Enter the card or mobile money reversal reference')
    const refundRate = original.sale.rateSnapshot || original.sale.exchangeRate
    const refundStep = original.sale.zigRoundingStep || '0.05'
    const refundInZig = method === 'cash' && currency === 'ZWG'
    const approver = await approval.request(
      `Refund ${refundInZig ? `ZiG ${roundToStep(dec(refundTotal).mul(dec(refundRate)), refundStep)}` : `US$ ${refundTotal}`} against receipt ${original.sale.receiptNumber}`,
      'refund.approve',
    )
    if (!approver) return setError('The refund needs supervisor approval')
    setBusy(true)
    try {
      const refund = await completeRefund({
        original,
        items: Object.entries(qtys).map(([lineId, qty]) => ({ lineId, qty })),
        reason,
        approver,
        method,
        currency: method === 'cash' ? currency : 'USD',
        reference: method === 'cash' ? null : reference.trim(),
        shiftId: shift.id,
        cashier: actor,
      })
      toast.success(`Refund ${refund.receiptNumber} saved`)
      setCompletedId(refund.id)
    } catch (err) {
      setError(`The refund was not saved: ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid h-full grid-cols-[380px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r border-rule bg-surface">
        <form onSubmit={search} className="space-y-2 border-b border-rule p-4">
          <h1 className="text-lg font-semibold">Find the original sale</h1>
          <Field label="Receipt number or item barcode" htmlFor="return-search" hint="Only sales made on this till can be found offline.">
            <div className="flex gap-2">
              <Input ref={searchRef} id="return-search" value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" spellCheck={false} className="tnum" />
              <Button type="submit" size="icon" aria-label="Search">
                <Search />
              </Button>
            </div>
          </Field>
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {matches === null ? (
            <EmptyState icon={ReceiptText} title="Scan the receipt or an item">
              Type the receipt number printed at the top of the slip, or scan the barcode of the returned item.
            </EmptyState>
          ) : matches.length === 0 ? (
            <EmptyState icon={Search} title="No matching sale on this till">
              Check the number. Sales from another till need the server, which cannot search them yet.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-rule">
              {matches.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => void choose(s.id)} className={cn('flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-sunk', original?.sale.id === s.id && 'bg-teal-tint')}>
                    <span>
                      <span className="tnum block font-medium">{s.receiptNumber}</span>
                      <span className="text-[13px] text-ink-soft">{formatDateTime(s.completedAt)}</span>
                    </span>
                    <span className="tnum font-semibold">US$ {formatAmount(s.total)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className="min-h-0 overflow-y-auto p-5">
        {!original ? (
          <EmptyState icon={Undo2} title="Returns and refunds" className="h-full">
            Find the original sale on the left. Every refund needs a reason and supervisor approval.
          </EmptyState>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="tnum text-xl font-semibold">Receipt {original.sale.receiptNumber}</h2>
                <p className="text-ink-soft">
                  {formatDateTime(original.sale.completedAt)}, sold by {original.sale.cashierName}, paid {original.payments.map((p) => `${METHOD_LABELS[p.method]} ${formatMoney(p.amount, p.currency)}`).join(' and ')}
                </p>
              </div>
              <StatusChip state={original.sale.syncState} />
            </div>

            {error && <Notice tone="danger" title={error} />}

            <table className="w-full">
              <thead>
                <tr className="border-b border-rule text-left text-sm text-ink-soft">
                  <th className="py-2 font-medium">Item</th>
                  <th className="py-2 text-right font-medium">Paid</th>
                  <th className="py-2 text-center font-medium">Return</th>
                  <th className="py-2 text-right font-medium">Refund</th>
                </tr>
              </thead>
              <tbody>
                {original.lines.map((l) => {
                  const q = qtys[l.id] ?? '0'
                  const max = dec(l.refundableQty)
                  const setQ = (v: number) => setQtys((s) => ({ ...s, [l.id]: String(Math.max(0, Math.min(max.toNumber(), v))) }))
                  return (
                    <tr key={l.id} className="border-b border-rule">
                      <td className="py-2.5">
                        <p className="font-medium">{l.name}</p>
                        <p className="tnum text-[13px] text-ink-soft">
                          Sold {l.qty}
                          {dec(l.refundedQty).greaterThan(0) && `, already refunded ${l.refundedQty}`}
                        </p>
                      </td>
                      <td className="tnum py-2.5 text-right">{formatAmount(l.lineTotal)}</td>
                      <td className="py-2.5">
                        <div className="flex items-center justify-center gap-1.5">
                          <button type="button" aria-label={`Return one fewer ${l.name}`} disabled={dec(q).lessThanOrEqualTo(0)} onClick={() => setQ(Number(q) - 1)} className="grid size-11 place-items-center rounded-md border border-rule-strong disabled:opacity-35">
                            <Minus className="size-4" />
                          </button>
                          <span className="tnum min-w-10 text-center text-lg font-semibold">{q}</span>
                          <button type="button" aria-label={`Return one more ${l.name}`} disabled={dec(q).greaterThanOrEqualTo(max)} onClick={() => setQ(Number(q) + 1)} className="grid size-11 place-items-center rounded-md border border-rule-strong disabled:opacity-35">
                            <Plus className="size-4" />
                          </button>
                        </div>
                      </td>
                      <td className="tnum py-2.5 text-right font-medium">{dec(q).greaterThan(0) ? formatAmount(refundLineAmount(l, q)) : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Reason</legend>
              <div className="grid grid-cols-3 gap-2">
                {REFUND_REASONS.map((r) => (
                  <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className={cn('min-h-11 rounded-md border px-3 text-sm', reason === r ? 'border-teal bg-teal-tint font-medium text-teal' : 'border-rule-strong')}>
                    {r}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="grid grid-cols-[1fr_auto] items-end gap-4">
              <div>
                <legend className="mb-2 text-sm font-medium">Refund to</legend>
                <div className="flex gap-2">
                  {(['cash', 'card', 'mobile_money'] as PaymentMethod[]).map((m) => (
                    <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={cn('min-h-11 flex-1 rounded-md border text-sm', method === m ? 'border-teal bg-teal-tint font-medium text-teal' : 'border-rule-strong')}>
                      {METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>
              {method === 'cash' && (
                <div className="flex gap-2">
                  {settings.currencies.map((c) => (
                    <button key={c} type="button" aria-pressed={currency === c} onClick={() => setCurrency(c)} className={cn('min-h-11 rounded-md border px-3 text-sm', currency === c ? 'border-teal bg-teal text-on-teal' : 'border-rule-strong')}>
                      {CURRENCIES[c].symbol}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
            {method !== 'cash' && (
              <Field label="Reversal reference" htmlFor="refund-ref" hint="From the card terminal or mobile money reversal SMS.">
                <Input id="refund-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            )}

            <div className="flex items-center justify-between gap-4 rounded-lg bg-display px-5 py-4 text-display-ink">
              <div>
                <p className="text-sm text-display-soft">Refund total</p>
                <p className="tnum text-3xl font-semibold">
                  {method === 'cash' && currency === 'ZWG'
                    ? formatMoney(roundToStep(dec(refundTotal).mul(dec(original.sale.rateSnapshot || original.sale.exchangeRate)), original.sale.zigRoundingStep || '0.05'), 'ZWG')
                    : formatMoney(refundTotal, 'USD')}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={reset}>
                  Cancel
                </Button>
                <Button size="lg" className="bg-white text-display hover:bg-teal-tint" disabled={busy} onClick={() => void submit()}>
                  {busy ? 'Saving…' : 'Approve and refund'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      <ReceiptDialog
        saleId={completedId}
        autoPrint={settings.autoPrint}
        kickDrawer={method === 'cash'}
        actor={actor}
        closeLabel="Done"
        onClose={() => {
          setCompletedId(null)
          reset()
        }}
      />
      {approval.dialog}
    </div>
  )
}
