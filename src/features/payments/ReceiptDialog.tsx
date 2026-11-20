import { useEffect, useRef, useState } from 'react'
import { Inbox, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Kbd, Notice, Skeleton } from '@/components/ui/misc'
import { StatusChip } from '@/components/ui/status-chip'
import { db } from '@/db/schema'
import { formatMoney } from '@/lib/currency'
import { dec } from '@/lib/decimal'
import { useLive } from '@/lib/use-live'
import { useOnChange } from '@/lib/use-on-change'
import { loadReceiptData, openCashDrawer, printReceipt, type ReceiptData } from '@/services/printer'
import { buildReceiptModel } from '@/services/receipt-model'
import { logAudit, type Actor } from '@/features/sale/sale-service'
import { ReceiptView } from './ReceiptView'

/**
 * Shown only after the sale is committed. Printing happens here, after the commit,
 * so a jammed or missing printer can never lose or duplicate the sale.
 */
export function ReceiptDialog({
  saleId,
  autoPrint,
  kickDrawer,
  actor,
  onClose,
  closeLabel = 'Next sale',
  heading,
}: {
  heading?: string
  saleId: string | null
  autoPrint: boolean
  kickDrawer: boolean
  actor: Actor
  onClose: () => void
  closeLabel?: string
}) {
  const nextRef = useRef<HTMLButtonElement>(null)
  const [data, setData] = useState<ReceiptData | null>(null)
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState<string | null>(null)
  const sale = useLive(() => (saleId ? db.sales.get(saleId) : undefined), [saleId])
  const autoDone = useRef<string | null>(null)

  useOnChange(saleId, () => {
    setData(null)
    setPrintError(null)
  })
  useEffect(() => {
    if (!saleId) return
    let cancelled = false
    void loadReceiptData(saleId).then((d) => !cancelled && setData(d))
    return () => {
      cancelled = true
    }
  }, [saleId])

  async function print(reprint: boolean) {
    if (!saleId) return
    setPrinting(true)
    const result = await printReceipt(saleId, { reprint, openDrawer: !reprint && kickDrawer })
    setPrinting(false)
    if (result.ok) {
      setPrintError(null)
      if (reprint) {
        await logAudit({ actorId: actor.id, actorName: actor.name, action: 'receipt.reprinted', detail: `Receipt ${data?.sale.receiptNumber}`, shiftId: data?.sale.shiftId ?? null })
        toast.success('Receipt reprinted')
      }
    } else {
      setPrintError(result.error ?? 'Printer error')
    }
    nextRef.current?.focus()
  }

  useEffect(() => {
    if (!saleId || !data || autoDone.current === saleId) return
    autoDone.current = saleId
    // Printing talks to hardware, which is exactly what effects are for; it runs once per sale.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (autoPrint) void print(false)
    else if (kickDrawer) void openCashDrawer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId, data])

  const refund = data?.sale.kind === 'refund'
  const model = data ? buildReceiptModel(data) : null

  return (
    <Dialog open={!!saleId} onOpenChange={(o) => !o && onClose()} title={heading ?? (refund ? 'Refund completed' : 'Sale completed')} width="lg" initialFocus={nextRef}>
      <div className="grid gap-6 md:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {data ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip state={sale?.syncState ?? data.sale.syncState} />
                <span className="text-sm text-ink-soft">
                  Receipt <strong className="tnum text-ink">{data.sale.receiptNumber}</strong> (provisional number from this till)
                </span>
              </div>

              {!refund && dec(data.sale.changeDue).greaterThan(0) ? (
                <div className="rounded-lg bg-display p-5 text-display-ink">
                  <p className="text-display-soft">Give change</p>
                  <p className="tnum text-5xl font-semibold tracking-tight">{formatMoney(data.sale.changeDue, data.sale.changeCurrency)}</p>
                </div>
              ) : (
                <div className="rounded-lg border border-rule p-5">
                  <p className="text-ink-soft">{refund ? 'Refunded to customer' : 'Paid in full, no change'}</p>
                  <p className="tnum text-4xl font-semibold tracking-tight">{model ? formatMoney(model.total.value, model.total.currency) : ''}</p>
                </div>
              )}

              {printError ? (
                <Notice tone="warn" title="The receipt did not print" action={<Button size="sm" variant="secondary" onClick={() => void print(false)}>Try again</Button>}>
                  {printError}. The {refund ? 'refund' : 'sale'} is saved; you can reprint it later from History.
                </Notice>
              ) : (
                <p className="flex items-center gap-2 text-sm text-ink-soft" role="status">
                  <Printer className="size-4" />
                  {printing ? 'Printing…' : sale && sale.printCount > 0 ? `Printed ${sale.printCount} time${sale.printCount === 1 ? '' : 's'}` : autoPrint ? 'Sending to printer…' : 'Not printed'}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={printing} onClick={() => void print(!!sale && sale.printCount > 0)}>
                  <Printer /> {sale && sale.printCount > 0 ? 'Reprint' : 'Print'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const r = await openCashDrawer()
                    if (r.ok) await logAudit({ actorId: actor.id, actorName: actor.name, action: 'drawer.opened', detail: `After receipt ${data.sale.receiptNumber}`, shiftId: data.sale.shiftId })
                    if (r.ok) toast.success('Drawer opened')
                    else toast.error(`Drawer did not open: ${r.error}`)
                  }}
                >
                  <Inbox /> Open drawer
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-24" />
            </div>
          )}

          <Button ref={nextRef} size="lg" className="w-full" onClick={onClose}>
            {closeLabel} <Kbd className="border-white/30 bg-white/15 text-on-teal">Enter</Kbd>
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto rounded-md bg-sunk p-3">{data ? <ReceiptView data={data} /> : <Skeleton className="h-96" />}</div>
      </div>
    </Dialog>
  )
}
