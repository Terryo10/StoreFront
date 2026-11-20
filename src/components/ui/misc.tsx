import * as React from 'react'
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn('inline-flex min-w-7 items-center justify-center rounded border border-rule-strong border-b-2 bg-surface px-1.5 py-0.5 text-xs font-semibold text-ink', className)}>
      {children}
    </kbd>
  )
}

export function Notice({ tone = 'info', title, children, action, className }: { tone?: 'info' | 'warn' | 'danger'; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  const Icon = tone === 'danger' ? OctagonAlert : tone === 'warn' ? AlertTriangle : Info
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      className={cn(
        'flex items-start gap-3 rounded-md border px-3.5 py-2.5 text-sm',
        tone === 'info' && 'border-st-local/30 bg-st-local-bg text-st-local',
        tone === 'warn' && 'border-st-pending/30 bg-st-pending-bg text-st-pending',
        tone === 'danger' && 'border-st-rejected/30 bg-st-rejected-bg text-st-rejected',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-ink/80">{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children, action, className }: { icon: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-10 text-center', className)}>
      <Icon className="size-9 text-rule-strong" />
      <div className="max-w-sm">
        <p className="text-base font-semibold text-ink">{title}</p>
        {children && <p className="mt-1 text-sm text-ink-soft">{children}</p>}
      </div>
      {action}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton h-4', className)} />
}

export function Panel({ title, actions, children, className, bodyClassName }: { title?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('rounded-lg border border-rule bg-surface', className)}>
      {(title || actions) && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-rule px-4 py-2">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: React.ReactNode; hint?: string }>; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-md border border-rule-strong bg-surface p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn('min-h-10 flex-1 rounded px-3.5 text-sm font-medium', value === o.value ? 'bg-teal text-on-teal' : 'text-ink hover:bg-sunk')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, description, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; id: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <label htmlFor={id} className="text-[15px] font-medium">
          {label}
        </label>
        {description && <p className="text-sm text-ink-soft">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors', checked ? 'border-teal bg-teal' : 'border-rule-strong bg-sunk')}
      >
        {/* Flex, not absolute: a button centers its contents, which shoved the knob out of the track. */}
        <span className={cn('block size-5 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-5' : 'translate-x-0')} />
      </button>
    </div>
  )
}
