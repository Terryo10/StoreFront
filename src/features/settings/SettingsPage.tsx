import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { HardDrive, Printer, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useSyncMeta } from '@/app/hooks'
import { useBoot } from '@/app/boot'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Notice, Panel, Segmented, Toggle } from '@/components/ui/misc'
import type { AppSettings, PrinterSettings } from '@/db/types'
import { dec } from '@/lib/decimal'
import { can } from '@/lib/permissions'
import { formatBytes, getStorageStatus, requestPersistentStorage, type StorageStatus } from '@/lib/storage'
import { formatDateTime } from '@/lib/utils'
import { getBridge } from '@/services/bridge'
import { refreshCatalogue } from '@/services/catalogue'
import { drawerKickBytes, EscPos } from '@/services/escpos'
import { openCashDrawer } from '@/services/printer'
import { tokenStorageKind } from '@/services/secure-token'
import { useAuth } from '@/features/auth/auth-store'
import { ServerConnectionForm } from './ServerConnectionForm'
import { useSettings } from './settings-store'

export function SettingsPage() {
  const session = useAuth((s) => s.session)!
  const settings = useSettings((s) => s.settings)!
  const save = useSettings((s) => s.save)
  const canServer = can(session.role, 'settings.server')

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4">
        <h1 className="col-span-2 text-2xl font-semibold tracking-tight">Settings</h1>

        <Panel title="Server connection">
          {canServer ? (
            <ServerConnectionForm />
          ) : (
            <div className="space-y-2 text-sm">
              <p>
                Mode: <strong>{settings.apiMode === 'mock' ? 'Mock (demo, no server)' : 'Laravel server'}</strong>
              </p>
              <p className="break-all">
                Address: <strong>{settings.apiBaseUrl}</strong>
              </p>
              <p className="text-ink-soft">Only a manager can change the server. It can also be set on the sign-in screen.</p>
            </div>
          )}
        </Panel>

        <TillPanel settings={settings} save={save} />
        <PrinterPanel settings={settings} save={save} />
        <ScannerPanel settings={settings} save={save} />
        <CataloguePanel />
        <StoragePanel />
      </div>
    </div>
  )
}

type SaveFn = (patch: Partial<Omit<AppSettings, 'id'>>) => Promise<AppSettings>

function TillPanel({ settings, save }: { settings: AppSettings; save: SaveFn }) {
  const [tillCode, setTillCode] = useState(settings.tillCode)
  const [storeName, setStoreName] = useState(settings.storeName)
  const [rate, setRate] = useState(settings.defaultExchangeRate)
  const [step, setStep] = useState(settings.zigRoundingStep || '0.05')
  const [error, setError] = useState<string | null>(null)

  return (
    <Panel title="Till">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Till code" htmlFor="till-code" error={error} hint="Prefix on receipt numbers">
            <Input id="till-code" value={tillCode} maxLength={6} onChange={(e) => setTillCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          </Field>
          <Field label="Store name on receipts" htmlFor="store-name">
            <Input id="store-name" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Suggested ZiG per US$ for new shifts" htmlFor="default-rate">
            <Input id="default-rate" inputMode="decimal" className="tnum" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
          <Field label="ZiG rounding step" htmlFor="zig-step" hint="Receipt ZiG totals round to this. 0.05 is the nearest 5 cents.">
            <Input id="zig-step" inputMode="decimal" className="tnum" value={step} onChange={(e) => setStep(e.target.value)} />
          </Field>
        </div>
        <Button
          variant="secondary"
          onClick={async () => {
            if (tillCode.length < 2) return setError('Use at least 2 letters or digits')
            if (!/^\d+(\.\d{1,4})?$/.test(rate) || dec(rate).lessThanOrEqualTo(0)) return setError('The ZiG rate must be a number greater than zero')
            if (!/^\d+(\.\d{1,4})?$/.test(step) || dec(step).lessThanOrEqualTo(0)) return setError('The rounding step must be a number greater than zero')
            setError(null)
            await save({ tillCode, storeName: storeName.trim() || 'Store', defaultExchangeRate: rate, zigRoundingStep: step })
            toast.success('Till settings saved. A new till code applies from the next shift.')
          }}
        >
          Save till settings
        </Button>
        <div className="divide-y divide-rule border-t border-rule pt-1">
          <Toggle id="zig" checked={settings.currencies.includes('ZWG')} onChange={(v) => void save({ currencies: v ? ['USD', 'ZWG'] : ['USD'] })} label="Accept ZiG" description="Show ZiG as a tender currency at payment" />
          <Toggle id="discounts" checked={settings.allowLineDiscounts} onChange={(v) => void save({ allowLineDiscounts: v })} label="Allow line discounts" description="Cashiers still need a supervisor to approve each one" />
          <Toggle id="autoprint" checked={settings.autoPrint} onChange={(v) => void save({ autoPrint: v })} label="Print receipt automatically" />
          <Toggle id="dark" checked={settings.theme === 'dark'} onChange={(v) => void save({ theme: v ? 'dark' : 'light' })} label="Dark mode" description="For dim shops and night shifts" />
        </div>
      </div>
    </Panel>
  )
}

function PrinterPanel({ settings, save }: { settings: AppSettings; save: SaveFn }) {
  const [p, setP] = useState<PrinterSettings>(settings.printer)
  const [result, setResult] = useState<string | null>(null)
  const electron = !!getBridge()
  const update = (patch: Partial<PrinterSettings>) => setP((x) => ({ ...x, ...patch }))

  async function testPrint() {
    await save({ printer: p })
    const bytes = new EscPos(p.widthChars).align('center').bold(true).line('Printer test').bold(false).line(settings.storeName).rule().line(new Date().toLocaleString()).feed(3).cut().toArray()
    if (p.kind === 'mock' || !getBridge()) {
      setResult(p.mockFailure ? 'Mock printer reported: paper out' : `Mock printer accepted ${bytes.length} bytes`)
      return
    }
    const r = await getBridge()!.printer.printRaw({ kind: p.kind, host: p.host, port: p.port, devicePath: p.devicePath }, bytes)
    setResult(r.ok ? 'Test page sent' : `Failed: ${r.error}`)
  }

  return (
    <Panel title="Receipt printer">
      <div className="space-y-3">
        {!electron && <Notice tone="info" title="Browser mode uses the mock printer">Real ESC/POS printing needs the desktop app (Electron).</Notice>}
        <Segmented<PrinterSettings['kind']>
          label="Printer connection"
          value={p.kind}
          onChange={(kind) => update({ kind })}
          className="w-full"
          options={[
            { value: 'mock', label: 'Mock' },
            { value: 'network', label: 'Network (port 9100)' },
            { value: 'device', label: 'USB or serial' },
          ]}
        />
        {p.kind === 'network' && (
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label="Printer IP address" htmlFor="pr-host">
              <Input id="pr-host" value={p.host} onChange={(e) => update({ host: e.target.value })} />
            </Field>
            <Field label="Port" htmlFor="pr-port">
              <Input id="pr-port" inputMode="numeric" value={String(p.port)} onChange={(e) => update({ port: Number(e.target.value.replace(/\D/g, '')) || 9100 })} />
            </Field>
          </div>
        )}
        {p.kind === 'device' && (
          <Field label="Device path" htmlFor="pr-dev" hint="Windows: \\.\COM3 or a shared printer path. Linux: /dev/usb/lp0">
            <Input id="pr-dev" value={p.devicePath} onChange={(e) => update({ devicePath: e.target.value })} spellCheck={false} />
          </Field>
        )}
        <Field label="Paper width" htmlFor="pr-width">
          <select id="pr-width" value={p.widthChars} onChange={(e) => update({ widthChars: Number(e.target.value) as PrinterSettings['widthChars'] })} className="min-h-11 w-full rounded-md border border-rule-strong bg-surface px-3">
            <option value={32}>58 mm (32 characters)</option>
            <option value={42}>80 mm (42 characters)</option>
            <option value={48}>80 mm condensed (48 characters)</option>
          </select>
        </Field>
        {p.kind === 'mock' && <Toggle id="mock-fail" checked={p.mockFailure} onChange={(v) => update({ mockFailure: v })} label="Simulate printer failure" description="Use this to check that sales survive a jammed printer" />}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void save({ printer: p }).then(() => toast.success('Printer saved'))}>
            Save printer
          </Button>
          <Button variant="secondary" onClick={() => void testPrint()}>
            <Printer /> Test print
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await save({ printer: p })
              const r = await openCashDrawer()
              setResult(r.ok ? (r.detail ?? 'Drawer opened') : `Drawer failed: ${r.error}`)
            }}
          >
            Open drawer
          </Button>
        </div>
        {result && (
          <p role="status" className="text-sm text-ink-soft">
            {result}
          </p>
        )}
        <p className="text-xs text-ink-soft">Drawer kick command: ESC p 0 ({drawerKickBytes().length} bytes), sent through the printer.</p>
      </div>
    </Panel>
  )
}

function ScannerPanel({ settings, save }: { settings: AppSettings; save: SaveFn }) {
  const [test, setTest] = useState('')
  const [lastScan, setLastScan] = useState<string | null>(null)
  return (
    <Panel title="Barcode scanner">
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">Handheld USB scanners act as a keyboard. Set the scanner to send Enter (or Tab) after each barcode.</p>
        <Segmented<'Enter' | 'Tab'>
          label="Scanner suffix"
          value={settings.scannerSuffix}
          onChange={(v) => void save({ scannerSuffix: v })}
          options={[
            { value: 'Enter', label: 'Ends with Enter' },
            { value: 'Tab', label: 'Ends with Tab' },
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Shortest barcode" htmlFor="sc-min">
            <Input id="sc-min" inputMode="numeric" value={String(settings.scannerMinLength)} onChange={(e) => void save({ scannerMinLength: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} />
          </Field>
          <Field label="Max gap between keys (ms)" htmlFor="sc-gap" hint="Raise this for slow scanners">
            <Input id="sc-gap" inputMode="numeric" value={String(settings.scannerMaxInterKeyMs)} onChange={(e) => void save({ scannerMaxInterKeyMs: Math.max(10, Number(e.target.value.replace(/\D/g, '')) || 35) })} />
          </Field>
        </div>
        <Field label="Test: click here and scan" htmlFor="sc-test">
          <Input
            id="sc-test"
            value={test}
            onChange={(e) => setTest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === settings.scannerSuffix) {
                e.preventDefault()
                setLastScan(test)
                setTest('')
              }
            }}
            className="tnum"
          />
        </Field>
        {lastScan !== null && (
          <p role="status" className="tnum text-sm">
            Read <strong>{lastScan || '(empty)'}</strong>, {lastScan.length} characters
          </p>
        )}
      </div>
    </Panel>
  )
}

function CataloguePanel() {
  const meta = useSyncMeta()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  return (
    <Panel title="Catalogue and prices">
      <div className="space-y-3 text-sm">
        <p>
          Last updated <strong>{formatDateTime(meta?.catalogueUpdatedAt)}</strong> from {meta?.catalogueSource === 'server' ? 'the server' : 'demo data on this till'}.
        </p>
        <p className="text-ink-soft">{meta?.pullAvailable ? 'Incremental sync pull is available.' : 'Sync pull is not available, so refreshing downloads the full product list from GET /api/v1/products.'}</p>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const r = await refreshCatalogue(setProgress)
            setBusy(false)
            setProgress(null)
            await qc.invalidateQueries()
            if (r.ok) toast.success(r.message)
            else toast.error(r.message)
          }}
        >
          <RefreshCw className={busy ? 'animate-spin' : ''} /> Refresh catalogue
        </Button>
        {progress && <p role="status">{progress}</p>}
      </div>
    </Panel>
  )
}

function StoragePanel() {
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const [tokenKind, setTokenKind] = useState<string>('')
  const setBootStorage = useBoot((s) => s.setStorage)
  useEffect(() => {
    void getStorageStatus().then(setStatus)
    void tokenStorageKind().then((k) => setTokenKind(k === 'electron-safe-storage' ? 'Encrypted with Electron safeStorage' : 'Memory only (browser mode)'))
  }, [])
  return (
    <Panel title="Storage on this till">
      <div className="space-y-2 text-sm">
        <p className="flex items-center gap-2">
          <HardDrive className="size-4 text-ink-soft" /> Using <strong>{formatBytes(status?.usage ?? null)}</strong> of {formatBytes(status?.quota ?? null)}
          {status?.usageRatio != null && ` (${Math.round(status.usageRatio * 100)}%)`}
        </p>
        <p>
          Protected from browser clean-up: <strong>{status?.persisted === true ? 'Yes' : status?.persisted === false ? 'No' : 'Unknown'}</strong>
        </p>
        <p>
          Sign-in token: <strong>{tokenKind}</strong>
        </p>
        {status?.warning && <Notice tone="warn" title={status.warning} />}
        <Button
          variant="secondary"
          onClick={async () => {
            const ok = await requestPersistentStorage()
            const s = await getStorageStatus()
            setStatus(s)
            setBootStorage(s)
            if (ok) toast.success('Storage is protected')
            else toast.warning('The browser did not grant persistent storage')
          }}
        >
          Request protected storage
        </Button>
      </div>
    </Panel>
  )
}
