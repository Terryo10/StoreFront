export interface StorageStatus {
  persisted: boolean | null
  usage: number | null
  quota: number | null
  usageRatio: number | null
  warning: string | null
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return null
  }
}

export async function getStorageStatus(): Promise<StorageStatus> {
  let persisted: boolean | null = null
  let usage: number | null = null
  let quota: number | null = null
  try {
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted()
  } catch {
    persisted = null
  }
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate()
      usage = est.usage ?? null
      quota = est.quota ?? null
    }
  } catch {
    /* estimate unsupported */
  }
  const usageRatio = usage != null && quota != null && quota > 0 ? usage / quota : null
  let warning: string | null = null
  if (usageRatio != null && usageRatio > 0.8) {
    warning = `Local storage is ${Math.round(usageRatio * 100)}% full. Sync now and free disk space so new sales can be saved.`
  }
  return { persisted, usage, quota, usageRatio, warning }
}

export function formatBytes(n: number | null): string {
  if (n == null) return 'unknown'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
