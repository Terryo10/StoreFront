const DEVICE_KEY = 'pos.deviceId'

export function createId(): string {
  return crypto.randomUUID()
}

/**
 * The device UUID is mirrored in localStorage and in Dexie `syncMetadata`.
 * Dexie is authoritative; localStorage only lets the id survive an IndexedDB wipe.
 */
export function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing) return existing
    const id = createId()
    localStorage.setItem(DEVICE_KEY, id)
    return id
  } catch {
    return createId()
  }
}

export function defaultTillCode(deviceId: string): string {
  return `T${deviceId.replace(/-/g, '').slice(0, 4).toUpperCase()}`
}

/** Provisional receipt number: till code, shift number and per-shift sequence. */
export function formatReceiptNumber(tillCode: string, shiftNumber: number, sequence: number): string {
  return `${tillCode}-${String(shiftNumber).padStart(4, '0')}-${String(sequence).padStart(4, '0')}`
}
