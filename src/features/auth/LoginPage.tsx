import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { attemptLogin, DEMO_USERS } from './auth-store'
import { useSettingsStore } from '@/features/settings/settings-store'
import { serverUrlSchema } from '@/lib/validation'

export function LoginPage() {
  const navigate = useNavigate()
  const settings = useSettingsStore((s) => s.settings)
  const saveSettings = useSettingsStore((s) => s.save)
  const [email, setEmail] = useState('counter@demo.local')
  const [password, setPassword] = useState('demo')
  const [apiUrl, setApiUrl] = useState(settings?.apiBaseUrl ?? 'http://127.0.0.1:8000')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const parsed = serverUrlSchema.safeParse(apiUrl)
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? 'Invalid server URL')
        return
      }
      await saveSettings({ apiBaseUrl: parsed.data })
      await attemptLogin(email.trim(), password)
      toast.success('Signed in (mock session)')
      navigate('/')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_#d8ebe7,_#f4f6f5_55%)] px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-accent">Stocktake</CardTitle>
          <CardDescription>
            Self-hosted offline-first counting. Connect to your LAN Laravel server or use mock
            mode for local demo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="apiUrl">API server URL</Label>
              <Input
                id="apiUrl"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                autoComplete="url"
                inputMode="url"
              />
              <p className="text-xs text-muted">
                Mode: <strong>{settings?.apiMode ?? 'mock'}</strong> (change in Settings after
                login). Live Sanctum auth is not wired yet.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <div className="mt-6 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Demo users</p>
            <ul className="space-y-1 text-xs text-muted">
              {DEMO_USERS.map((u) => (
                <li key={u.email}>
                  <button
                    type="button"
                    className="text-left underline-offset-2 hover:underline"
                    onClick={() => {
                      setEmail(u.email)
                      setPassword('demo')
                    }}
                  >
                    {u.role}: {u.email} / demo
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
