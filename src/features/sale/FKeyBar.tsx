import { cn } from '@/lib/utils'

export interface FKey {
  key: string
  label: string
  onPress: () => void
  disabled?: boolean
  tone?: 'primary' | 'danger'
}

/** Function-key strip, like the key caps on a till keyboard. Every key is also clickable. */
export function FKeyBar({ keys }: { keys: FKey[] }) {
  return (
    <div className="flex shrink-0 items-stretch gap-px border-t border-rule bg-rule" role="toolbar" aria-label="Function keys">
      {keys.map((k) => (
        <button
          key={k.key}
          type="button"
          disabled={k.disabled}
          onClick={k.onPress}
          className={cn(
            'flex min-h-12 flex-1 items-center justify-center gap-2 px-2 text-[13px] font-medium disabled:opacity-40',
            k.tone === 'primary' ? 'bg-teal text-on-teal hover:bg-teal-hover' : 'bg-surface text-ink hover:bg-sunk',
            k.tone === 'danger' && 'text-st-rejected',
          )}
        >
          <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', k.tone === 'primary' ? 'bg-white/20' : 'bg-sunk text-ink-soft')}>{k.key}</span>
          {k.label}
        </button>
      ))}
    </div>
  )
}
