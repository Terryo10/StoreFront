import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'> & { invalid?: boolean }>(({ className, invalid, ...props }, ref) => (
  <input
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      'block min-h-11 w-full rounded-md border border-rule-strong bg-surface px-3 text-[15px] text-ink placeholder:text-ink-soft/80 disabled:opacity-50',
      invalid && 'border-st-rejected',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export function Field({ label, htmlFor, error, hint, children, className }: { label: string; htmlFor: string; error?: string | null; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-sm text-st-rejected">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-ink-soft">{hint}</p>
      ) : null}
    </div>
  )
}
