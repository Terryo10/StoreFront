import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Camera, History, Package } from 'lucide-react'
import { db } from '@/db/schema'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { SyncStatusBadge } from '@/components/SyncStatusBadge'
import { OfflineBanner } from '@/components/OfflineBanner'
import { NumericKeypad } from './NumericKeypad'
import {
  holdUnknownBarcode,
  lookupLocalProductByBarcode,
  recordCount,
} from '@/services/count-service'
import { isValidQuantityInput } from '@/lib/decimal'
import { useAuthStore } from '@/features/auth/auth-store'
import { canSeeExpected } from '@/lib/permissions'
import { useSettingsStore } from '@/features/settings/settings-store'
import { probeServer, type ConnectivityState } from '@/lib/connectivity'
import { getSyncSnapshot, processOutbox } from '@/services/sync-engine'
import type { CountMode, Product } from '@/domain/types'

export function ScannerScreen() {
  const { stocktakeId } = useParams()
  const scanRef = useRef<HTMLInputElement>(null)
  const role = useAuthStore((s) => s.session?.role ?? 'counter')
  const settings = useSettingsStore((s) => s.settings)
  const stocktake = useLiveQuery(
    () => (stocktakeId ? db.stocktakes.get(stocktakeId) : undefined),
    [stocktakeId],
  )
  const [scan, setScan] = useState('')
  const [product, setProduct] = useState<Product | null>(null)
  const [qty, setQty] = useState('')
  const [mode, setMode] = useState<CountMode>(settings?.replaceDefault ? 'replace' : 'add')
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<{ qty: string; status: 'pending' } | null>(null)
  const [conn, setConn] = useState<ConnectivityState>('checking')
  const [pullAvailable, setPullAvailable] = useState(false)
  const [cameraMsg, setCameraMsg] = useState<string | null>(null)

  const line = useLiveQuery(async () => {
    if (!stocktakeId || !product) return null
    return db.stocktakeLines.where({ stocktakeId, productId: product.id }).first()
  }, [stocktakeId, product?.id])

  const view = useLiveQuery(async () => {
    if (!stocktakeId || !product) return null
    return db.countViews.get(`${stocktakeId}:${product.id}:${stocktake?.locationId}`)
  }, [stocktakeId, product?.id, stocktake?.locationId])

  useEffect(() => {
    scanRef.current?.focus()
  }, [product])

  useEffect(() => {
    void getSyncSnapshot().then((s) => setPullAvailable(s.pullAvailable))
    if (settings?.apiMode === 'mock') {
      setConn('online')
      return
    }
    void probeServer(settings?.apiBaseUrl ?? '').then((r) => setConn(r.state))
  }, [settings?.apiBaseUrl, settings?.apiMode])

  useEffect(() => {
    if (stocktake?.status === 'draft' && stocktakeId) {
      void db.stocktakes.update(stocktakeId, {
        status: 'counting',
        startedAt: stocktake.startedAt ?? new Date().toISOString(),
      })
    }
  }, [stocktake, stocktakeId])

  async function resolveScan(code: string) {
    const trimmed = code.trim()
    if (!trimmed || !stocktakeId) return
    const found = await lookupLocalProductByBarcode(trimmed)
    if (!found) {
      await holdUnknownBarcode(stocktakeId, trimmed)
      toast.error('Unknown barcode held locally — product ID not invented')
      setProduct(null)
      setScan('')
      return
    }
    setProduct(found)
    setScan('')
    setQty('')
    setLastSaved(null)
  }

  async function confirmCount() {
    if (!product || !stocktake || !stocktakeId) return
    if (!isValidQuantityInput(qty)) {
      toast.error('Enter a valid quantity')
      return
    }
    setSaving(true)
    try {
      const result = await recordCount({
        stocktakeId,
        productId: product.id,
        locationId: stocktake.locationId,
        quantity: qty,
        mode,
        baseVersion: stocktake.version,
      })
      setLastSaved({ qty: result.displayQty, status: 'pending' })
      toast.success('Saved locally')
      setQty('')
      setProduct(null)
      // Return focus for next scan immediately after local persist
      requestAnimationFrame(() => scanRef.current?.focus())
      // Opportunistic foreground sync — never required for success UI
      void processOutbox()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save count')
    } finally {
      setSaving(false)
    }
  }

  function requestCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMsg('Camera API unavailable on this device. Use HID scanner or manual entry.')
      return
    }
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop())
        setCameraMsg(
          'Camera permission granted. Full barcode decode library not bundled in V1 — use HID/manual. Graceful fallback active.',
        )
      })
      .catch(() => {
        setCameraMsg('Camera permission denied. Continue with HID scanner or keypad entry.')
      })
  }

  const showExpected = stocktake ? canSeeExpected(role, stocktake.blind) : false

  return (
    <div className="space-y-3 p-4 pb-8">
      <OfflineBanner state={conn} pullAvailable={pullAvailable} />

      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">{stocktake?.name ?? 'Counting'}</h1>
          <p className="text-xs text-muted">
            {stocktake?.blind ? 'Blind count' : 'Open count'} · {stocktake?.locationName}
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link to={`/count/${stocktakeId}/history`}>
            <History className="h-4 w-4" /> History
          </Link>
        </Button>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="scan">
          Scan barcode
        </label>
        <Input
          id="scan"
          ref={scanRef}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void resolveScan(scan)
            }
          }}
          placeholder="Focus here for handheld HID scanner"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="none"
          className="font-mono text-lg"
        />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => void resolveScan(scan)}>
            Lookup
          </Button>
          <Button type="button" variant="outline" onClick={requestCamera} aria-label="Camera scan">
            <Camera className="h-4 w-4" />
          </Button>
        </div>
        {cameraMsg && <p className="text-xs text-muted">{cameraMsg}</p>}
      </div>

      {!product && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
          <Package className="h-8 w-8 text-muted" />
          <p className="text-sm text-muted">Scan or look up a product to count</p>
        </div>
      )}

      {product && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex h-24 items-center justify-center rounded border border-dashed border-border bg-background text-xs text-muted">
            Image placeholder
          </div>
          <div>
            <p className="text-lg font-semibold">{product.name}</p>
            <p className="font-mono text-xs text-muted">
              {product.sku} · {product.unit}
            </p>
          </div>
          {view && (
            <div className="flex items-center justify-between text-sm">
              <span>
                Current local count:{' '}
                <strong className="tabular-nums">{view.quantity}</strong>
              </span>
              <SyncStatusBadge status={view.syncStatus} />
            </div>
          )}
          {showExpected && line?.expectedQty != null ? (
            <p className="text-sm">
              Expected: <span className="tabular-nums">{line.expectedQty}</span>
            </p>
          ) : (
            <p className="sr-only" aria-hidden={false}>
              Expected quantity hidden for blind counting
            </p>
          )}
          {!showExpected && (
            <Badge variant="info">Expected hidden (blind)</Badge>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === 'replace' ? 'default' : 'secondary'}
              className="flex-1"
              onClick={() => setMode('replace')}
            >
              Replace
            </Button>
            <Button
              type="button"
              variant={mode === 'add' ? 'default' : 'secondary'}
              className="flex-1"
              onClick={() => setMode('add')}
            >
              Add
            </Button>
          </div>

          <div className="rounded-md border border-border bg-background px-3 py-3 text-center text-3xl font-bold tabular-nums">
            {qty || '0'}
          </div>

          <NumericKeypad value={qty} onChange={setQty} />

          <Button
            type="button"
            className="w-full min-h-14 text-base"
            disabled={saving}
            onClick={() => void confirmCount()}
          >
            {saving ? 'Saving locally…' : 'Confirm count'}
          </Button>
          <p className="text-xs text-muted">
            Undo is only via a new corrective event — previous events stay in history.
          </p>
          {lastSaved && (
            <p className="text-sm text-success">
              Last display qty {lastSaved.qty} · saved locally / pending sync
            </p>
          )}
        </div>
      )}

      <Button asChild variant="outline" className="w-full">
        <Link to={`/count/${stocktakeId}/submit`}>Submit session</Link>
      </Button>
    </div>
  )
}
