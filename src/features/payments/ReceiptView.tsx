import type { ReceiptData } from '@/services/printer'
import { renderReceipt } from '@/services/printer'
import { buildReceiptModel } from '@/services/receipt-model'
import { cn } from '@/lib/utils'

/** On-screen receipt preview. It renders the exact rows sent to the thermal printer. */
export function ReceiptView({ data, className }: { data: ReceiptData; className?: string }) {
  const rows = renderReceipt(buildReceiptModel(data))
  return (
    <div className={cn('mx-auto w-full max-w-[340px] border border-rule bg-white px-4 py-5 text-[12.5px] leading-[1.45] text-[#1a1a1a] [font-family:var(--font-receipt)]', className)} aria-label={`Receipt ${data.sale.receiptNumber}`}>
      {rows.map((r, i) => {
        if (r.kind === 'rule') return <div key={i} className="my-1.5 border-t border-dashed border-[#888]" />
        if (r.kind === 'center') return <p key={i} className={cn('text-center', r.strong && 'font-bold')}>{r.text}</p>
        if (r.kind === 'text') return <p key={i} className="whitespace-pre">{r.text}</p>
        return (
          <p key={i} className={cn('flex justify-between gap-3 whitespace-pre', r.strong && 'font-bold')}>
            <span className="truncate">{r.left}</span>
            <span>{r.right}</span>
          </p>
        )
      })}
    </div>
  )
}
