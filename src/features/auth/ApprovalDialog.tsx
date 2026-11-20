import { useCallback, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { ApiError, requestApproval } from '@/api'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/misc'
import { can, type Permission, type Role } from '@/lib/permissions'
import { errorMessage } from '@/lib/utils'
import { actorOf, useAuth } from './auth-store'
import type { Actor } from '@/features/sale/sale-service'

const APPROVER_ROLES: Role[] = ['supervisor', 'manager']

interface Pending {
  action: string
  resolve: (actor: Actor | null) => void
}

/**
 * Returns `request(action, permission)`. If the signed-in user already holds the permission the
 * promise resolves immediately with them as approver; otherwise a supervisor must enter email + PIN.
 * The server must re-check every approval; this is a UI gate only.
 */
export function useApproval() {
  const session = useAuth((s) => s.session)
  const [pending, setPending] = useState<Pending | null>(null)

  const request = useCallback(
    (action: string, permission: Permission): Promise<Actor | null> => {
      if (session && can(session.role, permission)) return Promise.resolve(actorOf(session))
      return new Promise((resolve) => setPending({ action, resolve }))
    },
    [session],
  )

  const dialog = (
    <ApprovalDialog
      pending={pending}
      onDone={(actor) => {
        pending?.resolve(actor)
        setPending(null)
      }}
    />
  )
  return { request, dialog }
}

// The dialog is private to the hook, so Fast Refresh boundaries do not matter here.
// eslint-disable-next-line react-refresh/only-export-components
function ApprovalDialog({ pending, onDone }: { pending: Pending | null; onDone: (a: Actor | null) => void }) {
  const emailRef = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !pin.trim()) {
      setError('Enter the supervisor email and PIN')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await requestApproval(email, pin, pending?.action ?? '', APPROVER_ROLES)
      if (!res.approved || !res.approver) {
        setError(res.message ?? 'Not approved')
        return
      }
      setEmail('')
      setPin('')
      onDone({ id: res.approver.id, name: res.approver.name })
    } catch (err) {
      setError(err instanceof ApiError && err.isNetwork ? 'Approval needs the server and it cannot be reached. Ask a supervisor to sign in on this till instead.' : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={!!pending}
      onOpenChange={(o) => {
        if (!o) {
          setError(null)
          onDone(null)
        }
      }}
      title="Supervisor approval"
      description={pending?.action}
      width="sm"
      initialFocus={emailRef}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="danger" title={error} />}
        <Field label="Supervisor email" htmlFor="approver-email">
          <Input ref={emailRef} id="approver-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="PIN" htmlFor="approver-pin">
          <Input id="approver-pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>
          <ShieldCheck /> {busy ? 'Checking…' : 'Approve'}
        </Button>
      </form>
    </Dialog>
  )
}
