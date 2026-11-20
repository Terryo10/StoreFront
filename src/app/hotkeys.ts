import { useEffect, useRef } from 'react'
import { isTextEntry } from '@/services/scanner'

export type HotkeyHandler = (e: KeyboardEvent) => void

export interface HotkeyOptions {
  /** Fire even while a dialog is open. Off by default so dialogs own the keyboard. */
  inDialog?: boolean
  /** Fire even while typing in a text field. Function keys default to true. */
  inInput?: boolean
}

function normalise(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey && e.key.length > 1) parts.push('Shift')
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key)
  return parts.join('+')
}

/**
 * Binds keyboard shortcuts such as `F10`, `Alt+1` or `Delete`. Keys the browser would otherwise
 * claim (F1 help, F3 find, F6 address bar, F10 menu) are prevented when bound.
 */
export function useHotkeys(bindings: Record<string, HotkeyHandler>, options: HotkeyOptions = {}, enabled = true) {
  const ref = useRef(bindings)
  useEffect(() => {
    ref.current = bindings
  })

  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      if (e.repeat && !['ArrowUp', 'ArrowDown'].includes(e.key)) return
      const combo = normalise(e)
      const handler = ref.current[combo]
      if (!handler) return
      const dialogOpen = !!document.querySelector('[role="dialog"], [role="alertdialog"]')
      if (dialogOpen && !options.inDialog) return
      const isFn = /^F\d{1,2}$/.test(e.key)
      const typing = isTextEntry(document.activeElement)
      if (typing && !(options.inInput ?? isFn) && !e.altKey && !e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      handler(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, options.inDialog, options.inInput])
}

export interface ShortcutDoc {
  keys: string[]
  action: string
}

export const SHORTCUTS: Array<{ group: string; items: ShortcutDoc[] }> = [
  {
    group: 'Everywhere',
    items: [
      { keys: ['F1'], action: 'Show this list of shortcuts' },
      { keys: ['Alt', '1'], action: 'Go to Sale' },
      { keys: ['Alt', '2'], action: 'Go to Returns' },
      { keys: ['Alt', '3'], action: 'Go to History' },
      { keys: ['Alt', '4'], action: 'Go to Stock count' },
      { keys: ['Alt', '5'], action: 'Go to Sync' },
      { keys: ['Alt', '6'], action: 'Go to Settings' },
      { keys: ['Esc'], action: 'Close a dialog or cancel' },
    ],
  },
  {
    group: 'Sale screen',
    items: [
      { keys: ['F2'], action: 'Jump to the scan and search field' },
      { keys: ['F3'], action: 'New sale (clears the current cart after confirming)' },
      { keys: ['F4'], action: 'Hold the current sale' },
      { keys: ['F6'], action: 'Resume a held sale' },
      { keys: ['F7'], action: 'Change quantity of the selected line' },
      { keys: ['F8'], action: 'Void the selected line' },
      { keys: ['F9'], action: 'Discount the selected line' },
      { keys: ['F10'], action: 'Take payment' },
      { keys: ['↑', '↓'], action: 'Select a cart line (when the scan field is empty)' },
      { keys: ['+', '−'], action: 'Change the selected line quantity (when the scan field is empty)' },
      { keys: ['3', '*', 'barcode'], action: 'Scan three of an item at once' },
    ],
  },
  {
    group: 'Payment',
    items: [
      { keys: ['F2'], action: 'Cash' },
      { keys: ['F3'], action: 'Card' },
      { keys: ['F4'], action: 'Mobile money' },
      { keys: ['F5'], action: 'Switch tender currency between US$ and ZiG' },
      { keys: ['F8'], action: 'Fill in the exact amount owed' },
      { keys: ['Enter'], action: 'Add the tender, or complete the sale once it is paid' },
    ],
  },
]
