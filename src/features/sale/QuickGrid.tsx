import { useState } from 'react'
import { PackageX } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { formatAmount } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { EmptyState, Skeleton } from '@/components/ui/misc'
import { listCategories, quickItems, type PricedProduct } from '@/services/catalogue'

export function QuickGrid({ onPick }: { onPick: (p: PricedProduct) => void }) {
  const [category, setCategory] = useState<string | null>(null)
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 60_000 })
  const items = useQuery({ queryKey: ['quick', category], queryFn: () => quickItems(category, 30), staleTime: 60_000 })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Categories" className="flex shrink-0 gap-1 overflow-x-auto border-b border-rule px-1">
        {[null, ...(categories.data ?? [])].map((c) => (
          <button
            key={c ?? 'all'}
            type="button"
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
            className={cn('min-h-11 shrink-0 border-b-[3px] px-3.5 text-sm font-medium', category === c ? 'border-teal text-teal' : 'border-transparent text-ink-soft hover:text-ink')}
          >
            {c ?? 'All'}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2" role="tabpanel">
        {items.isLoading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            {Array.from({ length: 15 }, (_, i) => (
              <Skeleton key={i} className="h-[78px]" />
            ))}
          </div>
        ) : items.data && items.data.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            {items.data.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!p.price}
                onClick={() => onPick(p)}
                className="flex min-h-[78px] flex-col justify-between rounded-md border border-rule bg-surface px-3 py-2 text-left hover:border-teal active:bg-teal-tint disabled:opacity-40"
              >
                <span className="line-clamp-2 text-[13.5px] font-medium leading-snug">{p.name}</span>
                <span className="tnum text-[13px] text-ink-soft">{p.price ? `US$ ${formatAmount(p.price)}` : 'No price'}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState icon={PackageX} title="No products in the local catalogue">
            Refresh the catalogue from Settings when the server is reachable.
          </EmptyState>
        )}
      </div>
    </div>
  )
}
