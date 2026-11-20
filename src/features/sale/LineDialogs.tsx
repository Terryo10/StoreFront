import { useEffect, useRef, useState } from 'react'
import { PauseCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/misc'
import { Field, Input } from '@/components/ui/input'
import type { CartLine, HeldSale } from '@/db/types'
import { formatAmount } from '@/lib/currency'
import { dec, money, parseDecimalInput } from '@/lib/decimal'
import { useOnChange } from '@/lib/use-on-change'
import { cn, formatTime } from '@/lib/utils'
import { cartTotals, lineGross, validateDiscount } from './cart-math'

export function QuantityDialog({ line, onClose, onSave }: { line: CartLine | null; onClose: () => void; onSave: (qty: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  useOnChange(line?.id, () => {
    if (line) {
      setValue(line.qty)
      setError(null)
    }
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = parseDecimalInput(value, { maxScale: 3 })
    if (!parsed || dec(parsed).lessThanOrEqualTo(0)) return setError('Enter a quantity greater than zero')
    if (dec(parsed).greaterThan(9999)) return setError('Quantity is too large; check the entry')
    onSave(parsed)
  }

  return (
    <Dialog open={!!line} onOpenChange={(o) => !o && onClose()} title="Change quantity" description={line?.name} width="sm" initialFocus={ref}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={`Quantity (${line?.unit ?? ''})`} htmlFor="qty-input" error={error}>
          <Input ref={ref} id="qty-input" inputMode="decimal" className="tnum h-14 text-2xl" value={value} onFocus={(e) => e.target.select()} onChange={(e) => setValue(e.target.value)} invalid={!!error} />
        </Field>
        <Button type="submit" className="w-full">
          Set quantity
        </Button>
      </form>
    </Dialog>
  )
}

export function DiscountDialog({ line, onClose, onSave }: { line: CartLine | null; onClose: () => void; onSave: (discount: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'amount' | 'percent'>('amount')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  useOnChange(line?.id, () => {
    if (line) {
      setValue(dec(line.discount).isZero() ? '' : line.discount)
      setMode('amount')
      setError(null)
    }
  })
  if (!line) return <Dialog open={false} onOpenChange={onClose} title="Line discount" />

  const gross = lineGross(line)
  const parsed = parseDecimalInput(value, { maxScale: 2 })
  const amount = parsed ? (mode === 'percent' ? money(dec(gross).mul(dec(parsed)).div(100)) : money(parsed)) : '0.00'

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!parsed) return setError('Enter a discount, or 0 to remove it')
    if (mode === 'percent' && dec(parsed).greaterThan(100)) return setError('A percentage cannot exceed 100')
    const err = validateDiscount(line!, amount)
    if (err) return setError(err)
    onSave(amount)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Line discount" description={`${line.name}, line value US$ ${formatAmount(gross)}`} width="sm" initialFocus={ref}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="flex gap-2">
          {(['amount', 'percent'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn('min-h-11 flex-1 rounded-md border text-sm font-medium', mode === m ? 'border-teal bg-teal-tint text-teal' : 'border-rule-strong')}>
              {m === 'amount' ? 'US$ amount' : 'Percentage'}
            </button>
          ))}
        </div>
        <Field label={mode === 'amount' ? 'Discount in US$' : 'Discount %'} htmlFor="disc-input" error={error} hint={`Customer pays US$ ${formatAmount(dec(gross).minus(dec(amount)).toFixed(2))} for this line`}>
          <Input ref={ref} id="disc-input" inputMode="decimal" className="tnum h-14 text-2xl" value={value} onChange={(e) => setValue(e.target.value)} invalid={!!error} />
        </Field>
        <Button type="submit" className="w-full">
          Apply discount
        </Button>
      </form>
    </Dialog>
  )
}

export function HoldDialog({ open, onClose, onHold }: { open: boolean; onClose: () => void; onHold: (label: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [label, setLabel] = useState('')
  useOnChange(open, (o) => o && setLabel(''))
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Hold this sale" description="The cart is saved on this till so you can serve someone else and resume it later." width="sm" initialFocus={ref}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onHold(label)
        }}
        className="space-y-4"
      >
        <Field label="Label (optional)" htmlFor="hold-label" hint="For example the customer's name or what they are fetching">
          <Input ref={ref} id="hold-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
        </Field>
        <Button type="submit" className="w-full">
          Hold sale
        </Button>
      </form>
    </Dialog>
  )
}

export function HeldSalesDialog({ open, held, onClose, onResume }: { open: boolean; held: HeldSale[]; onClose: () => void; onResume: (id: string) => void }) {
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  useOnChange(open, (o) => o && setActive(0))
  const hasHeld = held.length > 0
  useEffect(() => {
    if (open && hasHeld) setTimeout(() => listRef.current?.focus(), 0)
  }, [open, hasHeld])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Held sales" description="Use the arrow keys and press Enter to resume." width="md" initialFocus={listRef}>
      {held.length === 0 ? (
        <EmptyState icon={PauseCircle} title="No sales on hold">
          Press F4 on the sale screen to put a cart aside.
        </EmptyState>
      ) : (
        <ul
          ref={listRef}
          tabIndex={0}
          role="listbox"
          aria-label="Held sales"
          aria-activedescendant={`held-${active}`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((i) => Math.min(held.length - 1, i + 1))
            else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1))
            else if (e.key === 'Enter') onResume(held[active].id)
            else return
            e.preventDefault()
          }}
          className="divide-y divide-rule rounded-md border border-rule outline-none"
        >
          {held.map((h, i) => (
            <li key={h.id} id={`held-${i}`} role="option" aria-selected={i === active} className={cn('flex items-center justify-between gap-3 px-3 py-2.5', i === active && 'bg-teal-tint')}>
              <div>
                <p className="font-medium">{h.label}</p>
                <p className="text-sm text-ink-soft">
                  {h.lines.length} line{h.lines.length === 1 ? '' : 's'}, held at {formatTime(h.heldAt)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="tnum font-semibold">US$ {formatAmount(cartTotals(h).total)}</span>
                <Button size="sm" variant="secondary" onClick={() => onResume(h.id)}>
                  Resume
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
