import { useEffect, useRef } from 'react'
import { formatAmount } from '@/lib/currency'
import { dec } from '@/lib/decimal'
import type { CartTotals } from './cart-math'

/** The customer-display block: the one bold surface on the till. */
export function TotalDisplay({ totals, rate }: { totals: CartTotals; rate: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const prev = useRef(totals.total)

  useEffect(() => {
    if (prev.current !== totals.total && ref.current) {
      ref.current.classList.remove('total-tick')
      void ref.current.offsetWidth
      ref.current.classList.add('total-tick')
    }
    prev.current = totals.total
  }, [totals.total])

  const zig = dec(totals.total).mul(dec(rate)).toFixed(2)
  const hasDiscount = dec(totals.discountTotal).greaterThan(0)

  return (
    <div ref={ref} className="bg-display px-5 pb-4 pt-3 text-display-ink" aria-live="polite" aria-atomic="true">
      <div className="flex items-baseline justify-between text-sm text-display-soft">
        <span>
          {totals.itemCount} item{totals.itemCount === '1' ? '' : 's'}
          {hasDiscount && `, saved ${formatAmount(totals.discountTotal)}`}
        </span>
        <span className="tnum">1 US$ = {rate} ZiG</span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <span className="pb-2 text-base font-medium text-display-soft">Total US$</span>
        <span className="tnum text-[56px] font-semibold leading-none tracking-[-0.03em]" data-testid="cart-total">
          {formatAmount(totals.total)}
        </span>
      </div>
      <div className="tnum mt-1.5 text-right text-lg text-display-soft">ZiG {formatAmount(zig)}</div>
    </div>
  )
}
