export type TelemetryLevel = 'info' | 'warn' | 'error'

export interface TelemetryEntry {
  at: string
  level: TelemetryLevel
  event: string
  detail?: Record<string, unknown>
}

const MAX_ENTRIES = 500
const buffer: TelemetryEntry[] = []

/** Local-only ring buffer. Nothing is sent anywhere; it is included in diagnostics exports. */
export function track(event: string, detail?: Record<string, unknown>, level: TelemetryLevel = 'info') {
  buffer.push({ at: new Date().toISOString(), level, event, detail })
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)
  if (level === 'error') console.error(`[pos] ${event}`, detail ?? '')
  else if (level === 'warn') console.warn(`[pos] ${event}`, detail ?? '')
}

export function getTelemetry(): TelemetryEntry[] {
  return [...buffer]
}
