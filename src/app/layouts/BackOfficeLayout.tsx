import { NavLink, Outlet } from 'react-router-dom'
import {
  ClipboardList,
  LayoutDashboard,
  Package,
  Settings,
  ShieldAlert,
  RefreshCw,
  Smartphone,
  LogOut,
} from 'lucide-react'
import { useAuthStore } from '@/features/auth/auth-store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { canAccessBackOffice, canReviewVariances } from '@/lib/permissions'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium',
    isActive ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-card',
  )

export function BackOfficeLayout() {
  const session = useAuthStore((s) => s.session)
  const logout = useAuthStore((s) => s.logout)
  const role = session?.role ?? 'counter'

  if (!canAccessBackOffice(role) && role === 'counter') {
    // Counters can still open mobile counting from this shell link
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-b border-border bg-card md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <div>
            <p className="text-lg font-bold tracking-tight text-accent">Stocktake</p>
            <p className="text-xs text-muted">Offline-first · Zimbabwe</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:overflow-visible">
          <NavLink to="/" end className={linkClass}>
            <LayoutDashboard className="h-4 w-4" /> Dashboard
          </NavLink>
          <NavLink to="/products" className={linkClass}>
            <Package className="h-4 w-4" /> Products
          </NavLink>
          <NavLink to="/stocktakes" className={linkClass}>
            <ClipboardList className="h-4 w-4" /> Stocktakes
          </NavLink>
          {canReviewVariances(role) && (
            <NavLink to="/variances" className={linkClass}>
              <ShieldAlert className="h-4 w-4" /> Variances
            </NavLink>
          )}
          <NavLink to="/sync" className={linkClass}>
            <RefreshCw className="h-4 w-4" /> Sync
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            <Settings className="h-4 w-4" /> Settings
          </NavLink>
          <NavLink to="/count" className={linkClass}>
            <Smartphone className="h-4 w-4" /> Mobile count
          </NavLink>
        </nav>
        <div className="hidden border-t border-border p-3 md:block">
          <p className="truncate text-sm font-medium">{session?.name}</p>
          <p className="truncate text-xs text-muted">
            {session?.role} · {session?.authMode}
          </p>
          <Button variant="ghost" className="mt-2 w-full justify-start" onClick={() => logout()}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
