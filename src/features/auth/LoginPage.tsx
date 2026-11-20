import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ChevronDown, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/misc'
import { DEMO_USERS } from '@/api/mock'
import { useSettings } from '@/features/settings/settings-store'
import { ServerConnectionForm } from '@/features/settings/ServerConnectionForm'
import { homePathFor, ROLE_LABELS } from '@/lib/permissions'
import { errorMessage } from '@/lib/utils'
import { firstError, loginSchema } from '@/lib/validation'
import { tokenStorageKind } from '@/services/secure-token'
import { useAuth } from './auth-store'

export function LoginPage() {
  const session = useAuth((s) => s.session)
  const signIn = useAuth((s) => s.signIn)
  const settings = useSettings((s) => s.settings)!
  const navigate = useNavigate()
  const emailRef = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showServer, setShowServer] = useState(false)
  const [tokenNote, setTokenNote] = useState<string | null>(null)

  useEffect(() => {
    emailRef.current?.focus()
    void tokenStorageKind().then((k) =>
      setTokenNote(k === 'electron-safe-storage' ? 'Your sign-in token is encrypted by the operating system.' : 'Browser mode: the sign-in token is kept in memory only, so reloading asks you to sign in again.'),
    )
  }, [])

  if (session) return <Navigate to={homePathFor(session.role)} replace />

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const parsed = loginSchema.safeParse({ email, password })
    setErrors(firstError(parsed))
    if (!parsed.success) return
    setBusy(true)
    try {
      const s = await signIn(parsed.data.email, parsed.data.password)
      navigate(homePathFor(s.role), { replace: true })
    } catch (err) {
      setFormError(errorMessage(err, 'Sign-in failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-canvas p-6">
      <div className="grid w-full max-w-[880px] overflow-hidden rounded-xl border border-rule bg-surface md:grid-cols-[1fr_360px]">
        <form onSubmit={submit} noValidate className="space-y-5 p-8">
          <div>
            <p className="text-sm font-medium text-teal">Till {settings.tillCode}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sign in to start selling</h1>
            <p className="mt-1 text-ink-soft">{settings.storeName}</p>
          </div>

          {formError && <Notice tone="danger" title={formError} />}

          <Field label="Email" htmlFor="email" error={errors.email}>
            <Input ref={emailRef} id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!errors.email} />
          </Field>
          <Field label="Password" htmlFor="password" error={errors.password}>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!errors.password} />
          </Field>

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            <LogIn /> {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          {tokenNote && <p className="text-xs text-ink-soft">{tokenNote}</p>}
        </form>

        <aside className="flex flex-col gap-5 border-t border-rule bg-sunk p-6 md:border-l md:border-t-0">
          {settings.apiMode === 'mock' ? (
            <div>
              <h2 className="text-[15px] font-semibold">Demo accounts</h2>
              <p className="mt-0.5 text-sm text-ink-soft">Mock server is on. Password is <strong>demo</strong> for all.</p>
              <ul className="mt-3 divide-y divide-rule overflow-hidden rounded-md border border-rule bg-surface">
                {DEMO_USERS.map((u) => (
                  <li key={u.email}>
                    <button
                      type="button"
                      className="flex min-h-12 w-full items-center justify-between gap-2 px-3 text-left hover:bg-teal-tint"
                      onClick={() => {
                        setEmail(u.email)
                        setPassword('demo')
                      }}
                    >
                      <span>
                        <span className="block text-sm font-medium">{u.name}</span>
                        <span className="block text-xs text-ink-soft">{u.email}</span>
                      </span>
                      <span className="text-xs font-medium text-ink-soft">
                        {ROLE_LABELS[u.role]}
                        {u.pin && `, PIN ${u.pin}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div>
              <h2 className="text-[15px] font-semibold">Laravel server</h2>
              <p className="mt-0.5 break-all text-sm text-ink-soft">{settings.apiBaseUrl}</p>
              <p className="mt-2 text-sm text-ink-soft">Sign-in uses a Sanctum token from POST /api/v1/auth/login. That endpoint is assumed and may not exist on the server yet.</p>
            </div>
          )}

          <div className="mt-auto">
            <button type="button" aria-expanded={showServer} onClick={() => setShowServer((v) => !v)} className="flex min-h-11 w-full items-center justify-between text-sm font-semibold">
              Server connection
              <ChevronDown className={`size-4 transition-transform ${showServer ? 'rotate-180' : ''}`} />
            </button>
            {showServer && (
              <div className="pt-2">
                <ServerConnectionForm compact />
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
