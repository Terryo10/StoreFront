/**
 * HID ("keyboard wedge") scanner adapter.
 *
 * Handheld scanners type the barcode very fast and finish with Enter or Tab. When focus is
 * not in a text field, this listener buffers those bursts and emits them as scans, so a
 * scan still lands even if the cashier clicked somewhere else on the screen.
 */
export interface ScannerOptions {
  suffix: 'Enter' | 'Tab'
  minLength: number
  maxInterKeyMs: number
}

export function isTextEntry(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(el.type)
  }
  return (el as HTMLElement).isContentEditable === true
}

export function attachScanner(onScan: (code: string) => void, opts: ScannerOptions): () => void {
  let buffer = ''
  let last = 0

  function handler(e: KeyboardEvent) {
    if (isTextEntry(document.activeElement)) return
    if (document.querySelector('[role="dialog"]')) return
    const now = performance.now()
    if (now - last > opts.maxInterKeyMs * 4) buffer = ''
    last = now

    if (e.key === opts.suffix) {
      if (buffer.length >= opts.minLength) {
        e.preventDefault()
        onScan(buffer)
      }
      buffer = ''
      return
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) buffer += e.key
  }

  window.addEventListener('keydown', handler, true)
  return () => window.removeEventListener('keydown', handler, true)
}

/** Supports "3*6009000000012" to ring up three of an item in one scan. */
export function parseScanInput(raw: string): { quantity: string; code: string } {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*[*xX]\s*(.+)$/)
  if (m) return { quantity: m[1], code: m[2].trim() }
  return { quantity: '1', code: raw.trim() }
}
