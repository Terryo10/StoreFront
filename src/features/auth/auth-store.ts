import { create } from 'zustand'
import { getApiConfig, login as apiLogin, logout as apiLogout } from '@/api'
import { db } from '@/db/schema'
import type { LocalSession } from '@/db/types'
import type { Role } from '@/lib/permissions'
import { track } from '@/lib/telemetry'
import { clearToken, loadToken, saveToken, type TokenStorageKind } from '@/services/secure-token'
import { clearAuthBlock } from '@/services/sync-engine'

export interface Session {
  userId: string
  name: string
  email: string
  role: Role
  authMode: 'mock' | 'sanctum'
}

interface AuthState {
  session: Session | null
  tokenStorage: TokenStorageKind | null
  hydrate: () => Promise<void>
  signIn: (email: string, password: string) => Promise<Session>
  signOut: () => Promise<void>
}

function fromRow(row: LocalSession): Session {
  return { userId: row.userId, name: row.name, email: row.email, role: row.role, authMode: row.authMode }
}

export const useAuth = create<AuthState>((set) => ({
  session: null,
  tokenStorage: null,

  hydrate: async () => {
    const row = await db.session.get('session')
    if (!row) return set({ session: null })
    if (row.authMode === 'sanctum') {
      // A real session is only restored if its token is still in secure storage.
      const token = await loadToken()
      if (!token) {
        await db.session.delete('session')
        return set({ session: null })
      }
    }
    set({ session: fromRow(row) })
  },

  signIn: async (email, password) => {
    const res = await apiLogin(email, password)
    const mode = getApiConfig().mode
    let storage: TokenStorageKind | null = null
    if (mode === 'live') storage = await saveToken(res.token)
    const row: LocalSession = {
      id: 'session',
      userId: res.user.id,
      name: res.user.name,
      email: res.user.email,
      role: res.user.role,
      authMode: mode === 'live' ? 'sanctum' : 'mock',
      mockToken: mode === 'live' ? null : res.token,
      loggedInAt: new Date().toISOString(),
    }
    await db.session.put(row)
    await clearAuthBlock()
    const session = fromRow(row)
    track('auth.signed_in', { role: session.role, mode })
    set({ session, tokenStorage: storage })
    return session
  },

  signOut: async () => {
    await apiLogout()
    await clearToken()
    await db.session.delete('session')
    set({ session: null, tokenStorage: null })
  },
}))

export function actorOf(session: Session) {
  return { id: session.userId, name: session.name }
}
