import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'

/** Subscribes a component to an IndexedDB query; re-renders when the underlying tables change. */
export function useLive<T>(querier: () => Promise<T> | T, deps: unknown[]): T | undefined
export function useLive<T>(querier: () => Promise<T> | T, deps: unknown[], initial: T): T
export function useLive<T>(querier: () => Promise<T> | T, deps: unknown[], initial?: T): T | undefined {
  const [value, setValue] = useState<T | undefined>(initial)
  useEffect(() => {
    const sub = liveQuery(querier).subscribe({
      next: setValue,
      error: (err) => console.error('[pos] live query failed', err),
    })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return value
}
