/**
 * Typed view of the API exposed by electron/preload.cjs through contextBridge.
 * Absent when the app runs in a plain browser (Vite dev, Playwright).
 */
export interface PrinterTarget {
  kind: 'mock' | 'network' | 'device'
  host?: string
  port?: number
  devicePath?: string
}

export interface PrintResult {
  ok: boolean
  error?: string
  detail?: string
}

export interface PosBridge {
  isElectron: true
  appInfo: () => Promise<{ version: string; platform: string; userData: string; safeStorage: boolean }>
  secureStore: {
    available: () => Promise<boolean>
    set: (key: string, value: string) => Promise<void>
    get: (key: string) => Promise<string | null>
    remove: (key: string) => Promise<void>
  }
  printer: {
    printRaw: (target: PrinterTarget, bytes: number[]) => Promise<PrintResult>
    openDrawer: (target: PrinterTarget) => Promise<PrintResult>
  }
}

declare global {
  interface Window {
    posBridge?: PosBridge
  }
}

export function getBridge(): PosBridge | null {
  return typeof window !== 'undefined' && window.posBridge?.isElectron ? window.posBridge : null
}

export function isElectron(): boolean {
  return getBridge() !== null
}
