import { forwardRef, useEffect, useId, useState } from 'react'
import { ScanBarcode, Search } from 'lucide-react'
import { formatAmount } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/misc'
import { searchProducts, type PricedProduct } from '@/services/catalogue'

interface Props {
  /** Resolve a scanned or typed code. Return false when nothing matched. */
  onCode: (raw: string) => Promise<boolean>
  onPick: (product: PricedProduct) => void
  /** Keys pressed while the field is empty (cart navigation). */
  onEmptyKey: (key: 'ArrowUp' | 'ArrowDown' | '+' | '-' | 'Delete') => void
  message: { tone: 'error' | 'ok'; text: string } | null
}

export const ScanBar = forwardRef<HTMLInputElement, Props>(function ScanBar({ onCode, onPick, onEmptyKey, message }, ref) {
  const [value, setValue] = useState('')
  const [results, setResults] = useState<PricedProduct[]>([])
  const [active, setActive] = useState(0)
  const listId = useId()
  const looksLikeText = /[a-z]/i.test(value) && value.trim().length >= 2

  useEffect(() => {
    if (!looksLikeText) {
      setResults([])
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      const r = await searchProducts(value)
      if (!cancelled) {
        setResults(r)
        setActive(0)
      }
    }, 90)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [value, looksLikeText])

  function pick(p: PricedProduct) {
    onPick(p)
    setValue('')
    setResults([])
  }

  async function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setActive((i) => (e.key === 'ArrowDown' ? Math.min(results.length - 1, i + 1) : Math.max(0, i - 1)))
      return
    }
    if (!value && ['ArrowUp', 'ArrowDown', '+', '-', 'Delete'].includes(e.key)) {
      e.preventDefault()
      onEmptyKey(e.key as 'ArrowUp' | 'ArrowDown' | '+' | '-' | 'Delete')
      return
    }
    if (e.key === 'Escape' && value) {
      e.preventDefault()
      e.stopPropagation()
      setValue('')
      setResults([])
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (!value.trim()) return
      e.preventDefault()
      if (results.length > 0 && looksLikeText) {
        pick(results[active])
        return
      }
      const raw = value
      setValue('')
      const ok = await onCode(raw)
      if (!ok && looksLikeText) setValue(raw)
    }
  }

  return (
    <div className="relative">
      <label htmlFor="scan" className="sr-only">
        Scan barcode or search products
      </label>
      <div className="flex items-center gap-3 rounded-lg border-2 border-teal bg-surface px-3">
        {looksLikeText ? <Search className="size-5 text-teal" aria-hidden /> : <ScanBarcode className="size-6 text-teal" aria-hidden />}
        <input
          ref={ref}
          id="scan"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Scan a barcode, or type a name or SKU"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
          aria-describedby="scan-msg"
          className="tnum h-14 min-w-0 flex-1 bg-transparent text-xl outline-none placeholder:text-base placeholder:text-ink-soft"
        />
        <Kbd className="hidden lg:inline-flex">F2</Kbd>
      </div>
      <p id="scan-msg" aria-live="assertive" className={cn('mt-1 min-h-5 px-1 text-sm', message?.tone === 'error' ? 'font-medium text-st-rejected' : 'text-ink-soft')}>
        {message?.text ?? ''}
      </p>

      {results.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-[60px] z-30 max-h-[360px] overflow-y-auto rounded-md border border-rule-strong bg-surface py-1 shadow-lg">
          {results.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(p)
              }}
              className={cn('flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-1.5', i === active && 'bg-teal-tint')}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="text-[13px] text-ink-soft">{p.sku}</span>
              </span>
              <span className="tnum shrink-0 font-semibold">{p.price ? `US$ ${formatAmount(p.price)}` : 'No price'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})
