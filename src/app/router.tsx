import { Navigate, Route, Routes } from 'react-router-dom'
import { BackOfficeLayout } from './layouts/BackOfficeLayout'
import { MobileCountLayout } from './layouts/MobileCountLayout'
import { LoginPage } from '@/features/auth/LoginPage'
import { useAuthStore } from '@/features/auth/auth-store'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { ProductsPage } from '@/features/products/ProductsPage'
import { StocktakesPage } from '@/features/stocktakes/StocktakesPage'
import { CreateStocktakePage } from '@/features/stocktakes/CreateStocktakePage'
import { StocktakeDetailPage } from '@/features/stocktakes/StocktakeDetailPage'
import { VariancesPage } from '@/features/variances/VariancesPage'
import { SyncMonitorPage } from '@/features/sync/SyncMonitorPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { CountSessionsPage } from '@/features/counting/CountSessionsPage'
import { ScannerScreen } from '@/features/counting/ScannerScreen'
import { CountHistoryPage } from '@/features/counting/CountHistoryPage'
import { SubmitSessionPage } from '@/features/counting/SubmitSessionPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const session = useAuthStore((s) => s.session)
  const ready = useAuthStore((s) => s.ready)
  if (!ready) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted">Loading…</div>
  }
  if (!session) return <Navigate to="/login" replace />
  return children
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <BackOfficeLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="stocktakes" element={<StocktakesPage />} />
        <Route path="stocktakes/new" element={<CreateStocktakePage />} />
        <Route path="stocktakes/:id" element={<StocktakeDetailPage />} />
        <Route path="variances" element={<VariancesPage />} />
        <Route path="sync" element={<SyncMonitorPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route
        path="/count"
        element={
          <RequireAuth>
            <MobileCountLayout />
          </RequireAuth>
        }
      >
        <Route index element={<CountSessionsPage />} />
        <Route path=":stocktakeId" element={<ScannerScreen />} />
        <Route path=":stocktakeId/history" element={<CountHistoryPage />} />
        <Route path=":stocktakeId/submit" element={<SubmitSessionPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
