import { useState } from 'react'
import { CheckCircle2, PlugZap, XCircle } from 'lucide-react'
import { probeServer } from '@/api'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/misc'
import { seedDemoData } from '@/db/seed'
import type { ApiMode } from '@/db/types'
import { serverUrlSchema } from '@/lib/validation'
import { useSettings } from './settings-store'
import { useConnectivity } from '@/features/sync/connectivity-store'

export function ServerConnectionForm({ compact = false }: { compact?: boolean }) {
  const settings = useSettings((s) => s.settings)!
  const save = useSettings((s) => s.save)
  const [mode, setMode] = useState<ApiMode>(settings.apiMode)
  const [url, setUrl] = useState(settings.apiBaseUrl)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = mode !== settings.apiMode || url.trim() !== settings.apiBaseUrl

  async function apply(test: boolean) {
    setResult(null)
    const parsed = serverUrlSchema.safeParse(url)
    if (mode === 'live' && !parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }
    setError(null)
    setBusy(true)
    try {
      await save({ apiMode: mode, apiBaseUrl: parsed.success ? parsed.data.replace(/\/$/, '') : url })
      if (mode === 'mock') await seedDemoData()
      if (test) {
        const r = await probeServer()
        setResult({ ok: r.reachable, text: r.reachable ? `Reached the server (${r.detail}${r.latencyMs != null ? `, ${r.latencyMs} ms` : ''})` : `Could not reach the server: ${r.detail}` })
      }
      void useConnectivity.getState().probe()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Backend</p>
        <Segmented<ApiMode>
          label="Backend mode"
          value={mode}
          onChange={setMode}
          className="w-full"
          options={[
            { value: 'mock', label: 'Mock (demo, no server)' },
            { value: 'live', label: 'Laravel server' },
          ]}
        />
        {!compact && (
          <p className="text-sm text-ink-soft">
            {mode === 'mock'
              ? 'Every server response is simulated on this till. Nothing leaves the device.'
              : 'The till calls your self-hosted Laravel API. Endpoints are provisional until the backend confirms them.'}
          </p>
        )}
      </div>

      <Field label="Server address" htmlFor="server-url" error={error} hint={mode === 'mock' ? 'Ignored in mock mode.' : 'LAN or self-hosted address, for example http://192.168.1.10:8000'}>
        <Input id="server-url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={mode === 'mock'} invalid={!!error} inputMode="url" autoComplete="off" spellCheck={false} />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => void apply(true)} disabled={busy}>
          <PlugZap /> {dirty ? 'Save and test connection' : 'Test connection'}
        </Button>
        {result && (
          <p role="status" className={`flex items-center gap-1.5 text-sm ${result.ok ? 'text-st-synced' : 'text-st-rejected'}`}>
            {result.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />} {result.text}
          </p>
        )}
      </div>
    </div>
  )
}
