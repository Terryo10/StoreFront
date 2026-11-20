import * as React from 'react'
import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Radix dialog: focus is trapped inside and Esc closes it, which the keyboard flow relies on. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'md',
  initialFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  width?: 'sm' | 'md' | 'lg' | 'xl'
  initialFocus?: React.RefObject<HTMLElement | null>
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-[rgb(12_20_19/0.55)]" />
        <D.Content
          onOpenAutoFocus={(e) => {
            if (initialFocus?.current) {
              e.preventDefault()
              initialFocus.current.focus()
            }
          }}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-rule bg-surface text-ink',
            width === 'sm' && 'max-w-sm',
            width === 'md' && 'max-w-lg',
            width === 'lg' && 'max-w-3xl',
            width === 'xl' && 'max-w-5xl',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
            <div>
              <D.Title className="text-lg font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-sm text-ink-soft">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="-mr-2 -mt-1 grid size-11 place-items-center rounded-md text-ink-soft hover:bg-sunk" aria-label="Close (Esc)">
              <X className="size-5" />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-rule px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  destructive = false,
  busy = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  destructive?: boolean
  busy?: boolean
}) {
  const confirmRef = React.useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width="sm"
      initialFocus={confirmRef}
      footer={
        <>
          <button type="button" className="min-h-11 rounded-md border border-rule-strong px-4 hover:bg-sunk" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={cn('min-h-11 rounded-md px-4 font-medium disabled:opacity-50', destructive ? 'bg-st-rejected text-white' : 'bg-teal text-on-teal')}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[15px] text-ink">{body}</div>
    </Dialog>
  )
}
