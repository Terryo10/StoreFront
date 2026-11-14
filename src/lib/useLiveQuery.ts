import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'

export function useLiveQuery<T>(
  querier: () => T | Promise<T>,
  deps: unknown[] = [],
  initial?: T,
): T | undefined {
  const [value, setValue] = useState<T | undefined>(initial)

  useEffect(() => {
    const observable = liveQuery(querier)
    const sub = observable.subscribe({
      next: (v) => setValue(v),
      error: (err) => console.error('liveQuery error', err),
    })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return value
}
