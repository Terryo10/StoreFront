import { useEffect, useRef } from 'react'
import { Minus, Plus, ScanLine, Trash2 } from 'lucide-react'
import type { CartLine } from '@/db/types'
import { formatAmount } from '@/lib/currency'
import { dec } from '@/lib/decimal'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/misc'
import { lineTotal } from './cart-math'

export function CartPanel({
  lines,
  selectedId,
  onSelect,
  onStep,
  onVoid,
}: {
  lines: CartLine[]
  selectedId: string | null
  onSelect: (id: string) => void
  onStep: (id: string, delta: 1 | -1) => void
  onVoid: (id: string) => void
}) {
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    if (!selectedId) return
    listRef.current?.querySelector(`[data-line="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, lines.length])

  if (lines.length === 0) {
    return (
      <EmptyState icon={ScanLine} title="Ready for the first item" className="h-full">
        Scan a barcode, type a name in the search field, or tap an item on the left.
      </EmptyState>
    )
  }

  return (
    <ol ref={listRef} aria-label="Cart" className="divide-y divide-rule">
      {lines.map((l) => {
        const selected = l.id === selectedId
        const discounted = dec(l.discount).greaterThan(0)
        return (
          <li
            key={l.id}
            data-line={l.id}
            aria-current={selected || undefined}
            onClick={() => onSelect(l.id)}
            className={cn('grid cursor-default grid-cols-[1fr_auto] gap-x-3 border-l-4 py-2 pl-3 pr-2', selected ? 'border-teal bg-teal-tint' : 'border-transparent')}
          >
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium" title={l.name}>
                {l.name}
              </p>
              <p className="tnum text-[13px] text-ink-soft">
                {formatAmount(l.unitPrice)} each
                {discounted && <span className="text-st-synced">, less {formatAmount(l.discount)}</span>}
              </p>
            </div>
            <p className="tnum self-start pt-0.5 text-right text-[15px] font-semibold">{formatAmount(lineTotal(l))}</p>

            <div className="col-span-2 mt-1.5 flex items-center gap-1.5">
              <button type="button" aria-label={`Decrease ${l.name}`} disabled={dec(l.qty).lessThanOrEqualTo(1)} onClick={(e) => (e.stopPropagation(), onStep(l.id, -1))} className="grid size-11 place-items-center rounded-md border border-rule-strong bg-surface disabled:opacity-35">
                <Minus className="size-4" />
              </button>
              <span className="tnum min-w-12 text-center text-lg font-semibold" aria-label={`Quantity ${l.qty}`}>
                {l.qty}
              </span>
              <button type="button" aria-label={`Increase ${l.name}`} onClick={(e) => (e.stopPropagation(), onStep(l.id, 1))} className="grid size-11 place-items-center rounded-md border border-rule-strong bg-surface">
                <Plus className="size-4" />
              </button>
              <span className="ml-1 text-[13px] text-ink-soft">{l.unit}</span>
              <button type="button" aria-label={`Void ${l.name}`} onClick={(e) => (e.stopPropagation(), onVoid(l.id))} className="ml-auto grid size-11 place-items-center rounded-md text-ink-soft hover:bg-st-rejected-bg hover:text-st-rejected">
                <Trash2 className="size-4" />
              </button>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
