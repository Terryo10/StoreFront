import { useEffect, useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { ensureSeeded } from '@/db/seed'
import { requestPersistentStorage, getStorageStatus } from '@/lib/storage'
import { useAuthStore } from '@/features/auth/auth-store'
import { useSettingsStore } from '@/features/settings/settings-store'
import { setUnauthorizedHandler } from '@/api'
import { toast } from 'sonner'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const hydrate = useAuthStore((s) => s.hydrate)
  const logout = useAuthStore((s) => s.logout)
  const loadSettings = useSettingsStore((s) => s.load)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await ensureSeeded()
      await loadSettings()
      await hydrate()
      setUnauthorizedHandler(() => {
        void logout()
        toast.error('Session unauthorized — signed out')
      })
      const persisted = await requestPersistentStorage()
      if (persisted === false) {
        const status = await getStorageStatus()
        if (status.warning) toast.warning(status.warning)
      }
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [hydrate, loadSettings, logout])

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-sm text-muted">
        Preparing offline database…
      </div>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {children}
        <Toaster richColors position="top-center" closeButton />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
