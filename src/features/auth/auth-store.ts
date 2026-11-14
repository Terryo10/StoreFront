import { create } from 'zustand'
import type { Role, Session } from '@/domain/types'
import { db } from '@/db/schema'
import { createId } from '@/lib/ids'

interface AuthState {
  session: Session | null
  ready: boolean
  hydrate: () => Promise<void>
  mockLogin: (email: string, role: Role, name?: string) => Promise<void>
  logout: () => Promise<void>
}

const DEMO_USERS: Array<{ email: string; role: Role; name: string; password: string }> = [
  { email: 'owner@demo.local', role: 'owner', name: 'Demo Owner', password: 'demo' },
  { email: 'manager@demo.local', role: 'manager', name: 'Demo Manager', password: 'demo' },
  { email: 'supervisor@demo.local', role: 'supervisor', name: 'Demo Supervisor', password: 'demo' },
  { email: 'counter@demo.local', role: 'counter', name: 'Demo Counter', password: 'demo' },
  { email: 'auditor@demo.local', role: 'auditor', name: 'Demo Auditor', password: 'demo' },
]

export { DEMO_USERS }

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  ready: false,

  hydrate: async () => {
    const row = await db.session.get('session')
    if (!row) {
      set({ session: null, ready: true })
      return
    }
    set({
      session: {
        userId: row.userId,
        name: row.name,
        email: row.email,
        role: row.role,
        token: row.token,
        authMode: row.authMode,
      },
      ready: true,
    })
  },

  mockLogin: async (email, role, name) => {
    const match = DEMO_USERS.find((u) => u.email === email) ?? {
      email,
      role,
      name: name ?? email,
      password: 'demo',
    }
    const session: Session = {
      userId: createId(),
      name: match.name,
      email: match.email,
      role: match.role,
      // Mock token only — never store real privileged credentials unencrypted.
      token: `mock.${createId()}`,
      authMode: 'mock',
    }
    await db.session.put({
      id: 'session',
      ...session,
      loggedInAt: new Date().toISOString(),
    })
    set({ session })
  },

  logout: async () => {
    await db.session.delete('session')
    set({ session: null })
  },
}))

export async function attemptLogin(email: string, password: string): Promise<Session> {
  const settings = await db.settings.get('app')
  const mode = settings?.apiMode ?? 'mock'

  if (mode === 'mock') {
    const user = DEMO_USERS.find((u) => u.email === email)
    if (!user || user.password !== password) {
      throw new Error('Invalid demo credentials. Use *@demo.local / demo')
    }
    await useAuthStore.getState().mockLogin(user.email, user.role, user.name)
    return useAuthStore.getState().session!
  }

  // Production Sanctum adapter stub — backend auth is not verified yet.
  throw new Error(
    'Live Sanctum authentication is not wired: backend login endpoint is not verified. Switch API mode to mock for local demo.',
  )
}
