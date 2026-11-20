import { useEffect, type ReactNode } from 'react'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster, toast } from 'sonner'
import { DatabaseZap } from 'lucide-react'
import { boot, useBoot } from './boot'
import { startSyncLoop } from '@/features/sync/connectivity-store'
import { Skeleton } from '@/components/ui/misc'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, networkMode: 'always' } },
})

let booted = false

export function AppProviders({ children }: { children: ReactNode }) {
  const status = useBoot((s) => s.status)
  const error = useBoot((s) => s.error)

  useEffect(() => {
    if (booted) return
    booted = true
    void boot()
  }, [])

  useEffect(() => {
    if (status !== 'ready') return
    const report = useBoot.getState().report
    if (report?.recoveredCartLines) toast.info(`Recovered the sale in progress (${report.recoveredCartLines} line${report.recoveredCartLines === 1 ? '' : 's'})`)
    if (report?.recoveredSyncEvents) toast.info(`${report.recoveredSyncEvents} event(s) were interrupted while sending and are queued again`)
    return startSyncLoop()
  }, [status])

  if (status === 'failed') {
    return (
      <div className="grid h-full place-items-center bg-canvas p-6">
        <div className="max-w-md rounded-lg border border-st-rejected/40 bg-surface p-6">
          <DatabaseZap className="size-8 text-st-rejected" />
          <h1 className="mt-3 text-xl font-semibold">The till database could not open</h1>
          <p className="mt-2 text-ink-soft">
            Sales cannot be recorded until local storage works. Close other windows of this app, check free disk space, then restart. Nothing has been deleted.
          </p>
          <pre className="mt-3 overflow-auto rounded bg-sunk p-2 text-xs">{error}</pre>
          <button type="button" className="mt-4 min-h-11 rounded-md bg-teal px-4 font-medium text-on-teal" onClick={() => location.reload()}>
            Restart the app
          </button>
        </div>
      </div>
    )
  }

  if (status !== 'ready') {
    return (
      <div className="flex h-full flex-col bg-canvas" aria-busy="true" aria-label="Starting the till">
        <div className="h-12 border-b border-rule bg-surface" />
        <div className="grid flex-1 grid-cols-[1fr_420px] gap-3 p-3">
          <div className="space-y-3">
            <Skeleton className="h-14" />
            <Skeleton className="h-10 w-2/3" />
            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: 15 }, (_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          </div>
          <Skeleton className="h-full" />
        </div>
        <p className="sr-only">Opening the local database…</p>
      </div>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        {children}
        <Toaster position="bottom-left" offset={{ bottom: 72, left: 16 }} duration={3000} closeButton richColors toastOptions={{ style: { fontFamily: 'var(--font-sans)' } }} />
      </HashRouter>
    </QueryClientProvider>
  )
}
