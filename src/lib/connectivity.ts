export type ConnectivityState = 'checking' | 'online' | 'offline' | 'unreachable'

/**
 * Real connectivity check against the configured API host.
 * navigator.onLine alone is not trusted.
 */
export async function probeServer(baseUrl: string, timeoutMs = 4000): Promise<{
  state: ConnectivityState
  detail: string
  latencyMs: number | null
}> {
  const started = performance.now()
  if (!baseUrl) {
    return { state: 'offline', detail: 'No API URL configured', latencyMs: null }
  }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    // Prefer a lightweight health probe; fall back to OPTIONS/HEAD on API root.
    const url = `${baseUrl.replace(/\/$/, '')}/api/v1/products?per_page=1`
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    const latencyMs = Math.round(performance.now() - started)
    if (res.ok || res.status === 401 || res.status === 403) {
      return { state: 'online', detail: `HTTP ${res.status}`, latencyMs }
    }
    return {
      state: 'unreachable',
      detail: `HTTP ${res.status}`,
      latencyMs,
    }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started)
    const message = err instanceof Error ? err.message : 'Network error'
    return { state: 'offline', detail: message, latencyMs }
  } finally {
    window.clearTimeout(timer)
  }
}
