import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/auth-store'
import { LoginPage } from '@/features/auth/LoginPage'
import { OpenShiftPage } from '@/features/shift/OpenShiftPage'
import { CloseShiftPage } from '@/features/shift/CloseShiftPage'
import { SalePage } from '@/features/sale/SalePage'
import { ReturnsPage } from '@/features/returns/ReturnsPage'
import { HistoryPage } from '@/features/history/HistoryPage'
import { CountListPage } from '@/features/counting/CountListPage'
import { CountScreen } from '@/features/counting/CountScreen'
import { SyncPage } from '@/features/sync/SyncPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { can, homePathFor, type Permission } from '@/lib/permissions'
import { TillLayout } from './TillLayout'
import { useOpenShift } from './hooks'

function RequireAuth({ children }: { children: ReactNode }) {
  const session = useAuth((s) => s.session)
  const location = useLocation()
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const session = useAuth((s) => s.session)
  if (!session) return null
  if (!can(session.role, permission)) return <Navigate to={homePathFor(session.role)} replace />
  return <>{children}</>
}

function RequireShift({ children }: { children: ReactNode }) {
  const shift = useOpenShift()
  if (shift === undefined) return null
  if (shift === null) return <Navigate to="/shift/open" replace />
  return <>{children}</>
}

function Home() {
  const session = useAuth((s) => s.session)
  return <Navigate to={session ? homePathFor(session.role) : '/login'} replace />
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <TillLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="/shift/open" element={<RequirePermission permission="shift.manage"><OpenShiftPage /></RequirePermission>} />
        <Route path="/shift/close" element={<RequirePermission permission="shift.manage"><CloseShiftPage /></RequirePermission>} />
        <Route path="/sale" element={<RequirePermission permission="sale.ring"><RequireShift><SalePage /></RequireShift></RequirePermission>} />
        <Route path="/returns" element={<RequirePermission permission="refund.create"><RequireShift><ReturnsPage /></RequireShift></RequirePermission>} />
        <Route path="/history" element={<RequirePermission permission="sale.ring"><HistoryPage /></RequirePermission>} />
        <Route path="/count" element={<RequirePermission permission="count.perform"><CountListPage /></RequirePermission>} />
        <Route path="/count/:stocktakeId" element={<RequirePermission permission="count.perform"><CountScreen /></RequirePermission>} />
        <Route path="/sync" element={<SyncPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Home />} />
    </Routes>
  )
}
