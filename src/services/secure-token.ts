import { getBridge } from './bridge'

const TOKEN_KEY = 'sanctum-token'
let memoryToken: string | null = null

export type TokenStorageKind = 'electron-safe-storage' | 'memory-only'

/**
 * Sanctum tokens are kept in Electron safeStorage (OS-encrypted) when available.
 * In a plain browser they stay in memory only, so a reload requires signing in again.
 * They are never written to localStorage or IndexedDB.
 */
export async function tokenStorageKind(): Promise<TokenStorageKind> {
  const bridge = getBridge()
  if (bridge && (await bridge.secureStore.available())) return 'electron-safe-storage'
  return 'memory-only'
}

export async function saveToken(token: string): Promise<TokenStorageKind> {
  memoryToken = token
  const bridge = getBridge()
  if (bridge && (await bridge.secureStore.available())) {
    await bridge.secureStore.set(TOKEN_KEY, token)
    return 'electron-safe-storage'
  }
  return 'memory-only'
}

export async function loadToken(): Promise<string | null> {
  if (memoryToken) return memoryToken
  const bridge = getBridge()
  if (bridge && (await bridge.secureStore.available())) {
    memoryToken = await bridge.secureStore.get(TOKEN_KEY)
  }
  return memoryToken
}

export async function clearToken(): Promise<void> {
  memoryToken = null
  const bridge = getBridge()
  if (bridge) await bridge.secureStore.remove(TOKEN_KEY)
}
