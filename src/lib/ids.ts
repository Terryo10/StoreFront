const DEVICE_KEY = 'stocktake.deviceId'

export function createId(): string {
  return crypto.randomUUID()
}

export function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY)
  if (existing) return existing
  const id = createId()
  localStorage.setItem(DEVICE_KEY, id)
  return id
}
