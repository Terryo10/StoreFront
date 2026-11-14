import { Delete } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function NumericKeypad({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (next: string) => void
  className?: string
}) {
  function press(key: string) {
    if (key === 'C') {
      onChange('')
      return
    }
    if (key === '⌫') {
      onChange(value.slice(0, -1))
      return
    }
    if (key === '.') {
      if (value.includes('.')) return
      onChange(value ? `${value}.` : '0.')
      return
    }
    if (value === '0' && key !== '.') {
      onChange(key)
      return
    }
    const next = `${value}${key}`
    const [, dec] = next.split('.')
    if (dec && dec.length > 6) return
    onChange(next)
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫']

  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      {keys.map((k) => (
        <Button
          key={k}
          type="button"
          variant="secondary"
          className="min-h-14 text-xl tabular-nums"
          onClick={() => press(k)}
          aria-label={k === '⌫' ? 'Backspace' : k}
        >
          {k === '⌫' ? <Delete className="h-5 w-5" /> : k}
        </Button>
      ))}
      <Button type="button" variant="outline" className="col-span-3 min-h-11" onClick={() => press('C')}>
        Clear
      </Button>
    </div>
  )
}
