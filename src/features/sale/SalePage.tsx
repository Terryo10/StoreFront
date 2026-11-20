import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Lock, PauseCircle } from 'lucide-react'
import { useHotkeys } from '@/app/hotkeys'
import { useOpenShift } from '@/app/hooks'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { db } from '@/db/schema'
import type { Sale } from '@/db/types'
import { formatAmount } from '@/lib/currency'
import { useLive } from '@/lib/use-live'
import { can } from '@/lib/permissions'
import { errorMessage } from '@/lib/utils'
import { lookupBarcode, type PricedProduct } from '@/services/catalogue'
import { attachScanner, parseScanInput } from '@/services/scanner'
import { useApproval } from '@/features/auth/ApprovalDialog'
import { actorOf, useAuth } from '@/features/auth/auth-store'
import { PaymentDialog } from '@/features/payments/PaymentDialog'
import { ReceiptDialog } from '@/features/payments/ReceiptDialog'
import { useSettings } from '@/features/settings/settings-store'
import { cartTotals, lineTotal } from './cart-math'
import { CartPanel } from './CartPanel'
import { FKeyBar } from './FKeyBar'
import { DiscountDialog, HeldSalesDialog, HoldDialog, QuantityDialog } from './LineDialogs'
import { QuickGrid } from './QuickGrid'
import { ScanBar } from './ScanBar'
import { TotalDisplay } from './TotalDisplay'
import { useCart } from './cart-store'
import { holdCart, logAudit, resumeHeld, voidCart } from './sale-service'

type DialogName = null | 'pay' | 'qty' | 'discount' | 'hold' | 'held' | 'void' | 'new'

export function SalePage() {
  const session = useAuth((s) => s.session)!
  const settings = useSettings((s) => s.settings)!
  const shift = useOpenShift()
  const navigate = useNavigate()
  const actor = actorOf(session)
  const { cart, selectedId, addProduct, step, setQty, setDiscount, voidLine, select, moveSelection } = useCart()
  const scanRef = useRef<HTMLInputElement>(null)
  const [dialog, setDialog] = useState<DialogName>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null)
  const [completedId, setCompletedId] = useState<string | null>(null)
  const [completedCash, setCompletedCash] = useState(false)
  const approval = useApproval()
  const held = useLive(() => (shift ? db.heldSales.where('shiftId').equals(shift.id).sortBy('heldAt') : []), [shift?.id], [])

  const totals = useMemo(() => cartTotals(cart), [cart])
  const selected = cart.lines.find((l) => l.id === selectedId) ?? null
  const empty = cart.lines.length === 0
  const anyDialog = dialog !== null || completedId !== null

  useEffect(() => {
    if (shift) useCart.setState({ shiftId: shift.id })
  }, [shift])

  const focusScan = useCallback(() => setTimeout(() => scanRef.current?.focus(), 0), [])
  const hasShift = !!shift
  useEffect(() => {
    if (hasShift && !anyDialog) focusScan()
  }, [hasShift, anyDialog, focusScan])

  const ring = useCallback(
    (product: PricedProduct, quantity = '1') => {
      try {
        const line = addProduct(product, quantity)
        setMessage({ tone: 'ok', text: `Added ${product.name}, ${line.qty} × US$ ${formatAmount(line.unitPrice)}` })
      } catch (err) {
        setMessage({ tone: 'error', text: errorMessage(err) })
      }
    },
    [addProduct],
  )

  const onCode = useCallback(
    async (raw: string) => {
      const { quantity, code } = parseScanInput(raw)
      const product = await lookupBarcode(code)
      if (!product) {
        if (!/[a-z]/i.test(code)) setMessage({ tone: 'error', text: `Barcode ${code} is not in this till's catalogue. Search by name, or set the item aside for a supervisor.` })
        return false
      }
      ring(product, quantity)
      return true
    },
    [ring],
  )

  useEffect(() => {
    return attachScanner((code) => void onCode(code).then(focusScan), {
      suffix: settings.scannerSuffix,
      minLength: settings.scannerMinLength,
      maxInterKeyMs: settings.scannerMaxInterKeyMs,
    })
  }, [onCode, focusScan, settings.scannerSuffix, settings.scannerMinLength, settings.scannerMaxInterKeyMs])

  async function requestDiscount() {
    if (!selected) return
    if (!settings.allowLineDiscounts) {
      toast.error('Line discounts are switched off on this till')
      return
    }
    setDialog('discount')
  }

  async function applyDiscount(amount: string) {
    if (!selected) return
    setDialog(null)
    const approver = await approval.request(`Discount of US$ ${amount} on ${selected.name}`, 'discount.approve')
    if (!approver) {
      toast.info('Discount not applied')
      return
    }
    setDiscount(selected.id, amount, approver.name)
    await logAudit({ actorId: actor.id, actorName: actor.name, action: 'discount.applied', detail: `US$ ${amount} on ${selected.name}, approved by ${approver.name}`, shiftId: shift?.id ?? null })
    focusScan()
  }

  async function doVoidLine() {
    if (!selected) return
    const line = voidLine(selected.id, actor.name)
    setDialog(null)
    if (line) {
      await logAudit({ actorId: actor.id, actorName: actor.name, action: 'line.voided', detail: `${line.qty} × ${line.name} (US$ ${lineTotal(line)})`, shiftId: shift?.id ?? null })
      setMessage({ tone: 'ok', text: `Voided ${line.name}. The void is logged.` })
    }
  }

  async function doHold(label: string) {
    if (!shift) return
    try {
      await useCart.getState().flushed
      await holdCart(useCart.getState().cart, shift.id, actor, label)
      setDialog(null)
      useCart.getState().reset()
      toast.success('Sale held. Press F6 to resume it.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function doResume(id: string) {
    if (!shift) return
    try {
      await useCart.getState().flushed
      const resumed = await resumeHeld(id, shift.id)
      useCart.getState().load(resumed, shift.id)
      setDialog(null)
      toast.success('Held sale resumed')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function doNewSale() {
    if (!shift) return
    await useCart.getState().flushed
    await voidCart(useCart.getState().cart, shift.id, actor, 'Cleared by cashier with New sale')
    useCart.getState().reset()
    setDialog(null)
    setMessage(null)
  }

  function onCompleted(sale: Sale, cash: boolean) {
    useCart.getState().reset()
    setDialog(null)
    setMessage(null)
    setCompletedCash(cash)
    setCompletedId(sale.id)
  }

  useHotkeys({
    F2: focusScan,
    F3: () => (empty ? focusScan() : setDialog('new')),
    F4: () => !empty && setDialog('hold'),
    F6: () => setDialog('held'),
    F7: () => selected && setDialog('qty'),
    F8: () => selected && setDialog('void'),
    F9: () => void requestDiscount(),
    F10: () => !empty && setDialog('pay'),
    Delete: () => selected && setDialog('void'),
  })

  if (!shift) return null

  const canDiscount = settings.allowLineDiscounts && can(session.role, 'sale.ring')

  return (
    <div className="flex h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(380px,34%)]">
        <section className="flex min-h-0 flex-col gap-1 p-3" aria-label="Find items">
          <ScanBar
            ref={scanRef}
            onCode={onCode}
            onPick={(p) => ring(p)}
            message={message}
            onEmptyKey={(k) => {
              if (k === 'ArrowUp') moveSelection(-1)
              else if (k === 'ArrowDown') moveSelection(1)
              else if (k === '+' && selected) step(selected.id, 1)
              else if (k === '-' && selected) step(selected.id, -1)
              else if (k === 'Delete' && selected) setDialog('void')
            }}
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-rule bg-surface">
            <QuickGrid onPick={(p) => (ring(p), focusScan())} />
          </div>
        </section>

        <section className="flex min-h-0 flex-col border-l border-rule bg-surface" aria-label="Current sale">
          <header className="flex min-h-12 items-center justify-between border-b border-rule px-4">
            <h1 className="text-[15px] font-semibold">Current sale</h1>
            <div className="flex items-center gap-2">
              {held.length > 0 && (
                <button type="button" onClick={() => setDialog('held')} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-st-pending-bg px-3 text-[13px] font-medium text-st-pending">
                  <PauseCircle className="size-3.5" /> {held.length} on hold
                </button>
              )}
              <Button size="sm" variant="quiet" onClick={() => navigate('/shift/close')}>
                <Lock className="size-4" /> Close shift
              </Button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CartPanel lines={cart.lines} selectedId={selectedId} onSelect={select} onStep={step} onVoid={(id) => (select(id), setDialog('void'))} />
          </div>
          <TotalDisplay totals={totals} rate={shift.exchangeRate} />
          <div className="bg-display px-4 pb-4">
            <Button size="lg" className="h-16 w-full bg-white text-lg font-semibold text-display hover:bg-teal-tint" disabled={empty} onClick={() => setDialog('pay')}>
              Pay US$ {formatAmount(totals.total)} <span className="ml-2 rounded bg-display/10 px-1.5 text-xs font-bold">F10</span>
            </Button>
          </div>
        </section>
      </div>

      <FKeyBar
        keys={[
          { key: 'F1', label: 'Shortcuts', onPress: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1' })) },
          { key: 'F3', label: 'New sale', onPress: () => !empty && setDialog('new'), disabled: empty },
          { key: 'F4', label: 'Hold', onPress: () => setDialog('hold'), disabled: empty },
          { key: 'F6', label: `Resume${held.length ? ` (${held.length})` : ''}`, onPress: () => setDialog('held') },
          { key: 'F7', label: 'Quantity', onPress: () => setDialog('qty'), disabled: !selected },
          { key: 'F8', label: 'Void line', onPress: () => setDialog('void'), disabled: !selected, tone: 'danger' },
          { key: 'F9', label: 'Discount', onPress: () => void requestDiscount(), disabled: !selected || !canDiscount },
          { key: 'F10', label: 'Pay', onPress: () => setDialog('pay'), disabled: empty, tone: 'primary' },
        ]}
      />

      <PaymentDialog
        open={dialog === 'pay'}
        cart={cart}
        shift={shift}
        cashier={actor}
        currencies={settings.currencies}
        beforeCommit={() => useCart.getState().flushed}
        onClose={() => setDialog(null)}
        onCompleted={(sale) => void db.payments.where('saleId').equals(sale.id).toArray().then((ps) => onCompleted(sale, ps.some((p) => p.method === 'cash')))}
      />
      <ReceiptDialog saleId={completedId} autoPrint={settings.autoPrint} kickDrawer={completedCash} actor={actor} onClose={() => setCompletedId(null)} />
      <QuantityDialog line={dialog === 'qty' ? selected : null} onClose={() => setDialog(null)} onSave={(q) => (selected && setQty(selected.id, q), setDialog(null))} />
      <DiscountDialog line={dialog === 'discount' ? selected : null} onClose={() => setDialog(null)} onSave={(d) => void applyDiscount(d)} />
      <HoldDialog open={dialog === 'hold'} onClose={() => setDialog(null)} onHold={(l) => void doHold(l)} />
      <HeldSalesDialog open={dialog === 'held'} held={held} onClose={() => setDialog(null)} onResume={(id) => void doResume(id)} />
      <ConfirmDialog
        open={dialog === 'void'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Void this line?"
        body={selected ? <p>Remove {selected.qty} × {selected.name} (US$ {lineTotal(selected)}) from the sale. The void is recorded with your name.</p> : null}
        confirmLabel="Void line"
        destructive
        onConfirm={() => void doVoidLine()}
      />
      <ConfirmDialog
        open={dialog === 'new'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Clear this sale and start again?"
        body={<p>All {cart.lines.length} line(s) are removed. Clearing is reported to the server for review. Use Hold (F4) if the customer is coming back.</p>}
        confirmLabel="Clear sale"
        destructive
        onConfirm={() => void doNewSale()}
      />
      {approval.dialog}
    </div>
  )
}
