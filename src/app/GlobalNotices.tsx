import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBoot } from './boot'
import { useSyncMeta, useSyncSnapshot } from './hooks'
import { Notice } from '@/components/ui/misc'
import { useSettings } from '@/features/settings/settings-store'
import { timeAgo } from '@/lib/utils'

const STALE_AFTER_MS = 24 * 60 * 60 * 1000
const PERSIST_DISMISS_KEY = 'pos.persistNoticeDismissed'

/** Persistent, honest warnings: stale prices, sync blocked by auth, storage at risk. */
export function GlobalNotices() {
  const meta = useSyncMeta()
  const snapshot = useSyncSnapshot()
  const report = useBoot((s) => s.report)
  const mode = useSettings((s) => s.settings?.apiMode)
  const [persistDismissed, setPersistDismissed] = useState(() => sessionStorage.getItem(PERSIST_DISMISS_KEY) === '1')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const notices: React.ReactNode[] = []

  if (snapshot?.authBlocked) {
    notices.push(
      <Notice key="auth" tone="danger" title="Syncing is paused: the server refused this till's sign-in" action={<Link className="self-center font-semibold underline" to="/sync">Review</Link>}>
        Sales keep saving on this till. Sign out and back in, then retry from the Sync screen.
      </Notice>,
    )
  }

  if (meta && mode === 'live') {
    const stale = !meta.catalogueUpdatedAt || now - new Date(meta.catalogueUpdatedAt).getTime() > STALE_AFTER_MS
    if (!meta.pullAvailable && (stale || meta.catalogueSource !== 'server')) {
      notices.push(
        <Notice key="stale" tone="warn" title="Prices may be out of date" action={<Link className="self-center font-semibold underline" to="/settings">Refresh catalogue</Link>}>
          The server has no sync pull yet, so price changes do not reach this till automatically. Catalogue last updated {timeAgo(meta.catalogueUpdatedAt)}.
        </Notice>,
      )
    }
  }

  if (report?.persistDenied && !persistDismissed) {
    notices.push(
      <Notice
        key="persist"
        tone="warn"
        title="Storage is not protected from clean-up"
        action={
          <button
            type="button"
            className="min-h-10 self-center rounded-md px-3 font-semibold underline"
            onClick={() => {
              sessionStorage.setItem(PERSIST_DISMISS_KEY, '1')
              setPersistDismissed(true)
            }}
          >
            Dismiss
          </button>
        }
      >
        The browser may delete local data when the disk is full. Sync often, and export diagnostics before clearing browser data.
      </Notice>,
    )
  } else if (report?.storage?.warning) {
    notices.push(<Notice key="quota" tone="warn" title="Local storage is filling up">{report.storage.warning}</Notice>)
  }

  if (notices.length === 0) return null
  return <div className="space-y-2 border-b border-rule bg-canvas px-3 py-2">{notices}</div>
}
