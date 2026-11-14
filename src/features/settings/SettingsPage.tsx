import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSettingsStore } from './settings-store'
import { serverUrlSchema } from '@/lib/validation'
import { formatBytes, getStorageStatus, requestPersistentStorage, type StorageStatus } from '@/lib/storage'
import { getOrCreateDeviceId } from '@/lib/ids'
import { useAuthStore } from '@/features/auth/auth-store'
import { canManageSettings } from '@/lib/permissions'

export function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)
  const role = useAuthStore((s) => s.session?.role ?? 'counter')
  const [apiUrl, setApiUrl] = useState(settings?.apiBaseUrl ?? '')
  const [storage, setStorage] = useState<StorageStatus | null>(null)

  useEffect(() => {
    setApiUrl(settings?.apiBaseUrl ?? '')
  }, [settings?.apiBaseUrl])

  useEffect(() => {
    void getStorageStatus().then(setStorage)
  }, [])

  if (!canManageSettings(role) && role === 'counter') {
    // Counters can view storage/offline policy but not change API mode
  }

  async function saveUrl() {
    const parsed = serverUrlSchema.safeParse(apiUrl)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid URL')
      return
    }
    await save({ apiBaseUrl: parsed.data })
    toast.success('API URL saved')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted">LAN server, scanner, storage, offline policy</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API server</CardTitle>
          <CardDescription>No public cloud host assumed. Configure your LAN Laravel URL.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="url">Base URL</Label>
            <Input id="url" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void saveUrl()} disabled={!canManageSettings(role)}>
              Save URL
            </Button>
            <Button
              variant={settings?.apiMode === 'mock' ? 'default' : 'secondary'}
              disabled={!canManageSettings(role)}
              onClick={() => void save({ apiMode: 'mock' })}
            >
              Mock mode
            </Button>
            <Button
              variant={settings?.apiMode === 'live' ? 'default' : 'secondary'}
              disabled={!canManageSettings(role)}
              onClick={() => void save({ apiMode: 'live' })}
            >
              Live mode
            </Button>
          </div>
          <p className="text-xs text-muted">
            Live mode still surfaces unimplemented endpoints (pull, auth, import) explicitly.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scanner</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(['hid', 'camera', 'manual'] as const).map((m) => (
            <Button
              key={m}
              variant={settings?.scannerMode === m ? 'default' : 'secondary'}
              onClick={() => void save({ scannerMode: m })}
            >
              {m}
            </Button>
          ))}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings?.replaceDefault ?? true}
              onChange={(e) => void save({ replaceDefault: e.target.checked })}
            />
            Default to replace mode
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Storage</CardTitle>
          <CardDescription>
            IndexedDB can be evicted if persistent storage is denied. Export diagnostics regularly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Device ID: <span className="font-mono text-xs">{getOrCreateDeviceId()}</span></p>
          <p>Persisted: {storage?.persisted == null ? 'unknown' : String(storage.persisted)}</p>
          <p>
            Usage: {formatBytes(storage?.usage ?? null)} / {formatBytes(storage?.quota ?? null)}
          </p>
          {storage?.warning && <p className="text-warning">{storage.warning}</p>}
          <Button
            variant="secondary"
            onClick={async () => {
              const ok = await requestPersistentStorage()
              toast.message(
                ok === true
                  ? 'Persistent storage granted'
                  : ok === false
                    ? 'Persistent storage denied'
                    : 'Persistent storage API unavailable',
              )
              setStorage(await getStorageStatus())
            }}
          >
            Request persistent storage
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <Button
              key={t}
              variant={settings?.theme === t ? 'default' : 'secondary'}
              onClick={() => void save({ theme: t })}
            >
              {t}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Offline policy</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted">
          <p>{settings?.offlinePolicyNote}</p>
          <p className="mt-2">
            Every count is written to IndexedDB before success UI. Sync acknowledgements only apply
            to exact event IDs returned by the server. Rejected events are never dropped.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
