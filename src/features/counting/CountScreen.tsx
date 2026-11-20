import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, EyeOff, PackageSearch, ScanBarcode, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { EmptyState, Notice, Segmented, Toggle } from '@/components/ui/misc'
import { StatusChip } from '@/components/ui/status-chip'
import { db } from '@/db/schema'
import type { CountEvent } from '@/db/types'
import { dec, parseDecimalInput } from '@/lib/decimal'
import { canSeeExpectedCounts } from '@/lib/permissions'
import { useLive } from '@/lib/use-live'
import { useOnChange } from '@/lib/use-on-change'
import { errorMessage, formatTime, plural } from '@/lib/utils'
import { lookupBarcode, type PricedProduct } from '@/services/catalogue'
import { attachScanner } from '@/services/scanner'
import { actorOf, useAuth } from '@/features/auth/auth-store'
import { useConnectivity } from '@/features/sync/connectivity-store'
import { useSettings } from '@/features/settings/settings-store'
import { countSummary, recordCorrection, recordCount, STOCKTAKE_STATUS_LABEL, submitStocktake } from './count-service'
type Target = { kind: 'product'; product: PricedProduct; barcode: string } | { kind: 'unknown'; barcode: string } | null

export function CountScreen() {
  const { stocktakeId = '' } = useParams()
  const session = useAuth((s) => s.session)!
  const settings = useSettings((s) => s.settings)!
  const reachability = useConnectivity((s) => s.reachability)
  const actor = actorOf(session)
  const stocktake = useLive(() => db.stocktakes.get(stocktakeId), [stocktakeId])
  const summary = useLive(() => countSummary(stocktakeId), [stocktakeId])
  const scanRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)
  const [scan, setScan] = useState('')
  const [target, setTarget] = useState<Target>(null)
  const [quantity, setQuantity] = useState('1')
  const [mode, setMode] = useState<'add' | 'replace'>('add')
  const [rapid, setRapid] = useState(false)
  const [qtyError, setQtyError] = useState<string | null>(null)
  const [correcting, setCorrecting] = useState<CountEvent | null>(null)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [busy, setBusy] = useState(false)

  const submitted = stocktake?.status === 'submitted_local' || stocktake?.status === 'submitted'
  const showExpected = !!stocktake && canSeeExpectedCounts(session.role, stocktake.blind)
  const names = useLive(async () => {
    const ids = [...new Set((summary?.events ?? []).map((e) => e.productId).filter(Boolean))] as string[]
    const products = await db.products.bulkGet(ids)
    return new Map(products.filter(Boolean).map((p) => [p!.id, p!.name]))
  }, [summary?.events.length])

  const focusScan = () => {
    setTimeout(() => scanRef.current?.focus(), 0)
  }
  const loaded = !!stocktake
  useEffect(() => {
    if (loaded) focusScan()
  }, [loaded])

  async function resolve(raw: string) {
    const code = raw.trim()
    setScan('')
    if (!code || submitted) return
    const product = await lookupBarcode(code)
    if (rapid && product) {
      await save({ kind: 'product', product, barcode: code }, '1', 'add')
      return
    }
    setTarget(product ? { kind: 'product', product, barcode: code } : { kind: 'unknown', barcode: code })
    setQuantity('1')
    setQtyError(null)
  }

  useEffect(() => {
    if (target) qtyRef.current?.select()
  }, [target])

  const resolveRef = useRef(resolve)
  useEffect(() => {
    resolveRef.current = resolve
  })
  useEffect(
    () => attachScanner((c) => void resolveRef.current(c), { suffix: settings.scannerSuffix, minLength: settings.scannerMinLength, maxInterKeyMs: settings.scannerMaxInterKeyMs }),
    [settings.scannerSuffix, settings.scannerMinLength, settings.scannerMaxInterKeyMs],
  )

  async function save(t: NonNullable<Target>, qty: string, m: 'add' | 'replace') {
    setBusy(true)
    try {
      const outcome = await recordCount({ stocktakeId, barcode: t.barcode, quantity: qty, mode: m, counter: actor })
      if (outcome.kind === 'counted') toast.success(`${outcome.productName}: your count is now ${outcome.event.resultingQty}`, { duration: 1800 })
      else toast.warning(`Barcode ${outcome.exception.barcode} saved to the exception list for a supervisor`)
      setTarget(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
      focusScan()
    }
  }

  function confirmQty(e: React.FormEvent) {
    e.preventDefault()
    if (!target) return
    const parsed = parseDecimalInput(quantity, { maxScale: 3 })
    if (parsed === null) return setQtyError('Enter a quantity of zero or more')
    void save(target, parsed, target.kind === 'unknown' ? 'add' : mode)
  }

  const recent = useMemo(() => [...(summary?.events ?? [])].reverse().slice(0, 40), [summary])

  if (stocktake === undefined) return null
  if (!stocktake) {
    return (
      <EmptyState icon={PackageSearch} title="This stock count is not on this device" action={<Button asChild variant="secondary"><Link to="/count">Back to stock counts</Link></Button>}>
        It may have been removed. Check the list for counts assigned to you.
      </EmptyState>
    )
  }

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_420px]">
      <section className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Link to="/count" className="mb-1 inline-flex min-h-9 items-center gap-1 text-sm text-ink-soft hover:text-ink">
              <ArrowLeft className="size-4" /> Stock counts
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">{stocktake.name}</h1>
            <p className="text-ink-soft">
              {stocktake.locationName}, {STOCKTAKE_STATUS_LABEL[stocktake.status].toLowerCase()}
            </p>
          </div>
          {stocktake.blind && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-st-local-bg px-3 py-1.5 text-sm font-medium text-st-local">
              <EyeOff className="size-4" /> Blind count: no expected quantities
            </span>
          )}
        </div>

        {submitted ? (
          <Notice tone={stocktake.status === 'submitted' ? 'info' : 'warn'} title={stocktake.status === 'submitted' ? 'Submitted and confirmed by the server' : 'Submitted on this device only'}>
            {stocktake.status === 'submitted'
              ? 'No more counts can be added from this device.'
              : 'The server has not confirmed this submission yet. It stays queued and will be sent when the server is reachable. Do not treat the count as final until it shows as confirmed.'}
          </Notice>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-4">
              <Segmented<'add' | 'replace'>
                label="Count mode"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'add', label: 'Add to my count', hint: 'Adds the quantity to what you have counted so far' },
                  { value: 'replace', label: 'Replace my count', hint: 'Sets your count for the item to exactly this quantity' },
                ]}
              />
              <div className="min-w-64">
                <Toggle id="rapid" checked={rapid} onChange={setRapid} label="Rapid scan" description="Every scan adds 1 without asking" />
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                void resolve(scan)
              }}
            >
              <label htmlFor="count-scan" className="sr-only">
                Scan barcode
              </label>
              <div className="flex items-center gap-3 rounded-lg border-2 border-teal bg-surface px-3">
                <ScanBarcode className="size-6 text-teal" aria-hidden />
                <input
                  ref={scanRef}
                  id="count-scan"
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  placeholder="Scan a barcode, or type it and press Enter"
                  autoComplete="off"
                  spellCheck={false}
                  className="tnum h-14 min-w-0 flex-1 bg-transparent text-xl outline-none placeholder:text-base placeholder:text-ink-soft"
                />
              </div>
            </form>

            {target ? (
              <form onSubmit={confirmQty} className="space-y-4 rounded-lg border border-rule bg-surface p-5" noValidate>
                {target.kind === 'product' ? (
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xl font-semibold">{target.product.name}</p>
                      <p className="tnum text-sm text-ink-soft">
                        {target.product.sku}, barcode {target.barcode}, counted in {target.product.unit}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-ink-soft">Your count so far</p>
                      <p className="tnum text-2xl font-semibold">{summary?.latest.get(target.product.id)?.resultingQty ?? '0'}</p>
                      {showExpected && stocktake.expected?.[target.product.id] !== undefined && <p className="tnum text-sm text-ink-soft">Expected {stocktake.expected[target.product.id]}</p>}
                    </div>
                  </div>
                ) : (
                  <Notice tone="warn" title={`Barcode ${target.barcode} is not in the catalogue`}>
                    Count it anyway. It goes to the exception list for a supervisor to identify; no product is created on this device.
                  </Notice>
                )}
                <Field label={target.kind === 'unknown' ? 'Quantity found' : mode === 'add' ? 'Quantity to add' : 'Total quantity on the shelf'} htmlFor="count-qty" error={qtyError}>
                  <Input ref={qtyRef} id="count-qty" inputMode="decimal" className="tnum h-16 text-3xl" value={quantity} onChange={(e) => setQuantity(e.target.value)} invalid={!!qtyError} />
                </Field>
                <div className="flex gap-2">
                  <Button variant="secondary" size="lg" onClick={() => (setTarget(null), focusScan())}>
                    Cancel
                  </Button>
                  <Button type="submit" size="lg" className="flex-1" disabled={busy}>
                    {busy ? 'Saving…' : target.kind === 'unknown' ? 'Save to exception list' : 'Save count'}
                  </Button>
                </div>
              </form>
            ) : (
              <EmptyState icon={ScanBarcode} title="Scan the next item">
                {stocktake.blind ? 'Count what is physically there. Expected quantities are not shown on this device.' : 'Scan an item to record how many are on the shelf.'}
              </EmptyState>
            )}
          </>
        )}
      </section>

      <aside className="flex min-h-0 flex-col border-l border-rule bg-surface">
        <div className="border-b border-rule p-4">
          <p className="tnum text-sm text-ink-soft">
            {plural(summary?.productsCounted ?? 0, 'item')} counted, {plural(summary?.events.length ?? 0, 'scan')}, {plural(summary?.exceptions.length ?? 0, 'unknown barcode')}
          </p>
          {!submitted && (
            <Button className="mt-3 w-full" variant="secondary" disabled={(summary?.events.length ?? 0) + (summary?.exceptions.length ?? 0) === 0} onClick={() => setConfirmSubmit(true)}>
              Submit count
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {(summary?.exceptions.length ?? 0) > 0 && (
            <div className="border-b border-rule">
              <h2 className="flex items-center gap-1.5 px-4 pt-3 text-sm font-semibold text-st-pending">
                <TriangleAlert className="size-4" /> Exception list
              </h2>
              <ul className="divide-y divide-rule">
                {summary!.exceptions.map((x) => (
                  <li key={x.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="tnum">
                      {x.barcode}, qty {x.quantity}
                    </span>
                    <StatusChip state={x.syncState} size="sm" />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h2 className="px-4 pt-3 text-sm font-semibold">Recent scans on this device</h2>
          {recent.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-soft">Nothing counted yet.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {recent.map((e) => (
                <li key={e.id} className="px-4 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{(e.productId && names?.get(e.productId)) ?? e.barcode}</p>
                      <p className="tnum text-xs text-ink-soft">
                        {formatTime(e.observedAt)}, {e.correctsEventId ? 'correction set' : e.mode === 'add' ? 'added' : 'set to'} {e.quantity}, your count {e.resultingQty}
                      </p>
                    </div>
                    <StatusChip state={e.syncState} size="sm" />
                  </div>
                  {!submitted && (
                    <button type="button" className="mt-1 min-h-9 text-sm font-medium text-teal hover:underline" onClick={() => setCorrecting(e)}>
                      Correct this
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <CorrectionDialog
        event={correcting}
        onClose={() => (setCorrecting(null), focusScan())}
        onSave={async (q) => {
          if (!correcting) return
          try {
            await recordCorrection({ eventId: correcting.id, quantity: q, counter: actor })
            toast.success('Correction saved as a new entry; the original stays in the history')
            setCorrecting(null)
            focusScan()
          } catch (err) {
            toast.error(errorMessage(err))
          }
        }}
      />

      <ConfirmDialog
        open={confirmSubmit}
        onOpenChange={setConfirmSubmit}
        title="Submit this stock count?"
        confirmLabel="Submit"
        busy={busy}
        onConfirm={async () => {
          setBusy(true)
          try {
            await submitStocktake(stocktakeId, actor)
            setConfirmSubmit(false)
            toast.success(reachability === 'online' ? 'Submitted on this device. Waiting for the server to confirm.' : 'Submitted on this device. The server is offline, so it will be sent later.')
          } catch (err) {
            toast.error(errorMessage(err))
          } finally {
            setBusy(false)
          }
        }}
        body={
          <div className="space-y-2">
            <p>You will not be able to add more counts from this device.</p>
            <p className="text-sm text-ink-soft">
              {reachability === 'online'
                ? 'The submission is queued and sent with the next sync. It is final only once the server confirms it.'
                : 'The server is unreachable. The submission is saved here and sent when the connection returns. It is not final until the server confirms it.'}
            </p>
          </div>
        }
      />
    </div>
  )
}

function CorrectionDialog({ event, onClose, onSave }: { event: CountEvent | null; onClose: () => void; onSave: (q: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  useOnChange(event?.id, () => {
    if (event) {
      setValue(event.resultingQty ?? '0')
      setError(null)
    }
  })
  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()} title="Correct a count" description="Enter the correct total. A new entry is recorded; the original is never edited." width="sm" initialFocus={ref}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const p = parseDecimalInput(value, { maxScale: 3 })
          if (p === null || dec(p).isNegative()) return setError('Enter a quantity of zero or more')
          onSave(p)
        }}
        className="space-y-4"
        noValidate
      >
        <Field label="Correct total" htmlFor="correct-qty" error={error}>
          <Input ref={ref} id="correct-qty" inputMode="decimal" className="tnum h-14 text-2xl" value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} invalid={!!error} />
        </Field>
        <Button type="submit" className="w-full">
          Save correction
        </Button>
      </form>
    </Dialog>
  )
}
